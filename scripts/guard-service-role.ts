/**
 * CI guard for the load-bearing security control of this system.
 *
 * `service_role` bypasses Row-Level Security entirely. A codebase that reaches for it by
 * default has RLS in name only — the policies exist, the dashboard shows them green, and
 * nothing is enforced.
 *
 * docs/adr/0013-supabase-as-database-platform.md confines it to three sanctioned uses:
 *   1. migrations (Supabase CLI, outside this codebase)
 *   2. the background worker (no user context)
 *   3. an explicit `infrastructure/system/` namespace for operations with no acting user
 *
 * This script fails the build when anything outside the allow-list references it.
 * Adding an entry is therefore a deliberate, visible, reviewable act.
 *
 * Run: npm run guard:service-role
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/**
 * Files permitted to reference the service-role connection or key.
 * Paths are POSIX-style, relative to the repository root.
 *
 * ADDING TO THIS LIST REQUIRES A REVIEWER TO AGREE THE CALL SITE HAS NO ACTING USER.
 */
const ALLOW_LIST: readonly string[] = [
  // The single factory. Not exported from the db barrel.
  'src/db/client.ts',
  // Supabase admin client factory (auth.admin calls: invite, signOut, MFA administration).
  'src/platform/supabase/admin-client.ts',
  // Storage adapter against the PRIVATE bucket.
  //
  // Reviewed and agreed: reproducing the authorisation rules of every owning record — a
  // customer's KYC document, a consignment photograph, a rendered gate pass — inside
  // `storage.objects` policies would mean the same rule written twice, in two languages,
  // drifting apart. Instead the application checks the owning record under RLS and this
  // adapter only carries bytes for an object key that check already approved.
  //
  // Safe because migration 0028 makes the bucket private and grants `authenticated` NO
  // access to storage.objects at all: there is no raw-URL path to bypass the check, and
  // every download is a signed URL minted after it.
  'src/platform/storage/supabase-file-storage.ts',
  // Config declares the variable; env.ts is the only reader of process.env.
  'src/config/env.ts',
]

/** Patterns that indicate use of the privileged path. */
const FORBIDDEN = [
  { re: /\bwithServiceDb\b/, what: 'withServiceDb()' },
  { re: /\bSUPABASE_SERVICE_ROLE_KEY\b/, what: 'SUPABASE_SERVICE_ROLE_KEY' },
  { re: /\bcreateAdminClient\b/, what: 'createAdminClient()' },
  { re: /\bserviceRoleKey\b/, what: 'serviceRoleKey' },
]

/**
 * Directory prefixes that are sanctioned by definition.
 *
 *   src/worker/          — sanctioned use (2). The background worker has no user context;
 *                          every job still sets an explicit system actor so the audit
 *                          trigger attributes the write.
 *   .../infrastructure/system/
 *                        — sanctioned use (3). Operations with genuinely no acting user
 *                          (credential issue during approval, outbox relay, reconciliation).
 */
const SANCTIONED_PREFIXES = [
  /^src[/]worker[/]/,
  /^src[/]modules[/][^/]+[/]infrastructure[/]system[/]/,
]

function isSanctioned(relativePath: string): boolean {
  return SANCTIONED_PREFIXES.some((pattern) => pattern.test(relativePath))
}

/**
 * Blank out comments and string literals while PRESERVING line numbers, so a violation
 * still reports the right line.
 *
 * Necessary because documentation legitimately names the forbidden symbols — this very
 * file does. A naive line-wise `//` strip misses multi-line block comments, which produced
 * a false positive on a doc comment in core/logging/logger.ts.
 */
function stripComments(source: string): string {
  let result = ''
  let i = 0
  const n = source.length

  while (i < n) {
    const two = source.slice(i, i + 2)

    if (two === '//') {
      while (i < n && source[i] !== '\n') {
        result += ' '
        i++
      }
      continue
    }

    if (two === '/*') {
      while (i < n && source.slice(i, i + 2) !== '*/') {
        result += source[i] === '\n' ? '\n' : ' '
        i++
      }
      result += '  '
      i += 2
      continue
    }

    // String and template literals: a symbol name inside one is data, not a call.
    const ch = source[i] as string
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      result += ' '
      i++
      while (i < n) {
        const cur = source[i] as string
        if (cur === '\\') {
          result += '  '
          i += 2
          continue
        }
        if (cur === quote) {
          result += ' '
          i++
          break
        }
        result += cur === '\n' ? '\n' : ' '
        i++
      }
      continue
    }

    result += ch
    i++
  }

  return result
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function main(): void {
  let files: string[]
  try {
    files = walk(SRC)
  } catch {
    console.log('guard:service-role — src/ not present yet, nothing to check.')
    return
  }

  const violations: string[] = []

  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join('/')
    if (ALLOW_LIST.includes(rel) || isSanctioned(rel)) continue

    const source = readFileSync(file, 'utf8')
    // Documentation that references the rule is fine — only CODE is a violation.
    const lines = stripComments(source).split(/\r?\n/)

    for (const { re, what } of FORBIDDEN) {
      lines.forEach((line, i) => {
        if (re.test(line)) {
          violations.push(`${rel}:${i + 1}  uses ${what}`)
        }
      })
    }
  }

  if (violations.length > 0) {
    console.error('\n✖ service_role confinement violated\n')
    for (const v of violations) console.error('  ' + v)
    console.error(
      '\n  service_role bypasses RLS. If this call site genuinely has no acting user,\n' +
        '  move it to <module>/infrastructure/system/ or add it to ALLOW_LIST in\n' +
        '  scripts/guard-service-role.ts with a reviewer’s agreement.\n' +
        '  See docs/adr/0013-supabase-as-database-platform.md\n',
    )
    process.exit(1)
  }

  console.log(
    `guard:service-role — OK (${files.length} files scanned, ${ALLOW_LIST.length} allow-listed).`,
  )
}

main()
