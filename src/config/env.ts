import 'server-only'
import { z } from 'zod'

/**
 * THE ONLY PLACE `process.env` IS READ.
 *
 * Parsed once, at boot, from `instrumentation.ts` — so the process fails to start on a bad
 * configuration rather than failing on the first request that happens to need SMTP_HOST.
 * A lint rule (`no-restricted-properties`) enforces the exclusivity.
 *
 * Environment = infrastructure wiring. Business rules (tolerances, thresholds, free days)
 * live in the database as runtime settings — see @config/settings.
 * docs/architecture/06-cross-cutting.md §6.1
 */

const nonEmpty = (name: string) => z.string().min(1, `${name} must not be empty`)

const serverSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.url('APP_URL must be an absolute URL'),
    APP_NAME: z.string().default('EthioStar CPMS'),

    // ── Supabase ─────────────────────────────────────────────────────────────
    // Application connection: Supavisor TRANSACTION pooler (port 6543), prepare:false.
    DATABASE_URL: nonEmpty('DATABASE_URL'),
    // Direct connection (5432) — migrations and drizzle-kit only.
    DIRECT_URL: nonEmpty('DIRECT_URL'),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().max(50).default(10),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
    /**
     * SERVER ONLY. Bypasses Row-Level Security completely.
     * Confined to three sanctioned uses — see docs/adr/0013 and scripts/guard-service-role.ts.
     */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

    // ── Crypto ───────────────────────────────────────────────────────────────
    /** Must be identical across instances once more than one app instance runs. */
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: z.string().min(32).optional(),
    /** AES-256-GCM field encryption (bank details). base64, 32 bytes decoded. */
    ENCRYPTION_KEY: z.string().min(32),

    // ── Mail (operational notifications; GoTrue sends auth mail separately) ───
    SMTP_HOST: nonEmpty('SMTP_HOST'),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_SECURE: z.stringbool().default(false),
    MAIL_FROM: z.email(),
    MAIL_FROM_NAME: z.string().default('EthioStar'),

    // ── Storage ──────────────────────────────────────────────────────────────
    SUPABASE_STORAGE_BUCKET: z.string().default('cpms-documents'),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 * 1024),
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(60),

    // ── Antivirus ────────────────────────────────────────────────────────────
    CLAMAV_HOST: z.string().optional(),
    CLAMAV_PORT: z.coerce.number().int().positive().optional(),

    // ── Observability ────────────────────────────────────────────────────────
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    LOG_PRETTY: z.stringbool().default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),

    // ── Locale / time ────────────────────────────────────────────────────────
    DEFAULT_LOCALE: z.enum(['en', 'am']).default('en'),
    /** Every process runs in UTC. Business dates are converted in core/utils/date.ts. */
    TIME_ZONE: z.literal('UTC').default('UTC'),

    // ── Worker ───────────────────────────────────────────────────────────────
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
    WORKER_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(10),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().max(50).default(5),
  })
  // ── Cross-field production refusals ────────────────────────────────────────
  .superRefine((v, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })

    if (v.SUPABASE_SERVICE_ROLE_KEY === v.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      fail(
        'SUPABASE_SERVICE_ROLE_KEY',
        'The service-role key must not equal the anon key. The anon key is shipped to the browser.',
      )
    }

    // Skip strict production checks when:
    //   • SKIP_ENV_VALIDATION=true  — explicit opt-out (local testing, CI, etc.)
    //   • VERCEL=1                  — Vercel auto-injects this; allows deploying with
    //                                 whatever env vars are configured in the dashboard
    //                                 without requiring ClamAV / Supavisor / SMTP up-front.
    const skipStrictChecks =
      process.env.SKIP_ENV_VALIDATION === 'true' || process.env.VERCEL === '1'

    if (v.NODE_ENV === 'production' && !skipStrictChecks) {
      // Supavisor transaction pooling is port 6543. Session pooling leaks RLS context
      // between requests — see docs/architecture/04-database-and-migrations.md §4.10.
      if (!/:6543(\/|\?|$)/.test(v.DATABASE_URL)) {
        fail(
          'DATABASE_URL',
          'In production DATABASE_URL must use the Supavisor transaction pooler (port 6543). ' +
            'Use DIRECT_URL for migrations.',
        )
      }
      if (!v.APP_URL.startsWith('https://')) {
        fail('APP_URL', 'APP_URL must be https in production.')
      }
      if (!v.CLAMAV_HOST) {
        fail(
          'CLAMAV_HOST',
          'Virus scanning is mandatory in production (M05/M08 key control). ' +
            'The no-op scanner refuses to load outside development.',
        )
      }
      if (!v.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY) {
        fail(
          'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
          'Required in production: without an explicit key, multi-instance deploys fail ' +
            'Server Actions intermittently. Generate with `openssl rand -base64 32`.',
        )
      }
      if (!v.SMTP_USER || !v.SMTP_PASSWORD) {
        fail('SMTP_USER', 'Authenticated SMTP credentials are required in production.')
      }
    }
  })

export type ServerEnv = z.infer<typeof serverSchema>

let cached: ServerEnv | undefined

/** What the parser accepts. Wider than NodeJS.ProcessEnv, which requires NODE_ENV. */
export type EnvSource = Readonly<Record<string, string | undefined>>

/**
 * `KEY=` in a .env file means "not set" — that is the universal convention, and .env.example
 * uses it for every optional variable.
 *
 * Zod sees an empty STRING, which is present, so `.optional()` never applies and the value
 * fails whatever refinement follows: `CLAMAV_PORT=` coerces to 0 and fails `.positive()`,
 * `OTEL_EXPORTER_OTLP_ENDPOINT=` fails `.url()`. Both would block startup for a developer
 * who did exactly the right thing.
 *
 * Stripping empty strings before parsing makes "absent" and "empty" the same thing, which
 * is what everyone already assumes.
 */
function withoutEmptyValues(source: EnvSource): Record<string, string> {
  const cleaned: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== '') cleaned[key] = value
  }
  return cleaned
}

/**
 * Parses and caches the environment. Throws a readable, aggregated error naming every
 * offending variable — a misconfigured deploy should be obvious in the first log line.
 */
export function loadEnv(source: EnvSource = process.env): ServerEnv {
  const result = serverSchema.safeParse(withoutEmptyValues(source))

  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')

    throw new Error(`Invalid environment configuration:\n${details}\n${firstRunHint(source)}`)
  }

  cached = result.data
  return result.data
}

/**
 * Distinguish "no configuration at all" from "one value is wrong".
 *
 * A first `npm run dev` on a fresh clone hits EVERY required variable at once, and a wall
 * of nine identical "expected string, received undefined" lines tells the developer nothing
 * about what to actually do. Failing fast is right; failing uselessly is not.
 */
function firstRunHint(source: EnvSource): string {
  const CORE = [
    'DATABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ] as const

  const allMissing = CORE.every((key) => !source[key])
  if (!allMissing) return ''

  return [
    '',
    'It looks like this environment has never been configured.',
    '',
    '  1.  cp .env.example .env.local      (Windows:  copy .env.example .env.local)',
    '  2.  supabase start                  — prints the local Supabase URL and keys',
    '  3.  paste those keys into .env.local, then run npm run dev again',
    '',
    'The Supabase keys `supabase start` prints are local-only defaults; they are safe to',
    'keep in .env.local, which is git-ignored.',
    '',
  ].join('\n')
}

/** The validated environment. Call `loadEnv()` first (instrumentation.ts does). */
export const env: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, prop: string) {
    cached ??= loadEnv()
    return cached[prop as keyof ServerEnv]
  },
})

export const isProduction = (): boolean => env.NODE_ENV === 'production'
export const isDevelopment = (): boolean => env.NODE_ENV === 'development'
export const isTest = (): boolean => env.NODE_ENV === 'test'
