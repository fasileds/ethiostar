/**
 * Seed runner.
 *
 * Seeds are IDEMPOTENT and run on every deploy — which also means they are exercised by
 * every CI build, so a broken seed is caught immediately rather than at the next release.
 *
 * Two categories:
 *   • Reference data (permissions, roles, master data, settings, numbering series) —
 *     always applied, in every environment including production.
 *   • Demo data — only with `--demo`, and it REFUSES to run when NODE_ENV=production.
 *
 * Run: npm run db:seed          npm run seed:demo
 */
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import { seedPermissions } from './010-permissions'
import { seedMasterData } from './030-master-data'
import { seedNotificationTemplates } from './040-notification-templates'
import { seedSettings } from './050-settings'
import { seedDemo } from './900-demo/index'
import { SYSTEM_ACTOR_ID } from '../../src/modules/identity/domain/actor'
import type { SeedContext, SeedStep } from './types'

const REFERENCE_STEPS: ReadonlyArray<{ name: string; run: SeedStep }> = [
  { name: '010-permissions', run: seedPermissions },
  { name: '030-master-data', run: seedMasterData },
  { name: '040-notification-templates', run: seedNotificationTemplates },
  { name: '050-settings', run: seedSettings },
]

const DEMO_STEP = { name: '900-demo', run: seedDemo }

function parseArgs(argv: readonly string[]): { includeDemo: boolean } {
  return { includeDemo: argv.includes('--demo') }
}

async function main(): Promise<void> {
  const { includeDemo } = parseArgs(process.argv.slice(2))
  const nodeEnv = process.env.NODE_ENV ?? 'development'

  if (includeDemo && nodeEnv === 'production') {
    console.error('✖ Refusing to seed demo data in production.')
    process.exit(1)
  }

  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!connectionString) {
    console.error('✖ DIRECT_URL (or DATABASE_URL) must be set.')
    process.exit(1)
  }

  // Seeds run as the connection owner, before RLS applies to them, and set an explicit
  // system actor so the audit trigger can attribute every row they write.
  const client = postgres(connectionString, { max: 1, prepare: false })
  const db = drizzle(client)
  // See src/db/client.ts `restoreDateSerializers` — drizzle's postgres-js adapter neuters
  // postgres.js's own date serializers ON THE `drizzle(client, ...)` CALL ITSELF, so this
  // must run AFTER that call, not before. Every raw `sql\`...\`` query here (as opposed to
  // schema-typed `db.insert().values()`) interpolates a plain `Date` with no encoder in
  // between, which postgres.js then fails to wire-encode. Restoring the real serializer is
  // required for this standalone seed client the same way it is for the app's pools.
  const serialize = (x: unknown): string =>
    (x instanceof Date ? x : new Date(x as string)).toISOString()
  for (const oid of [1184, 1082, 1114]) {
    client.options.serializers[oid] = serialize
  }

  const started = Date.now()
  let failed = false

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.actor_id', ${SYSTEM_ACTOR_ID}, true)`)
      await tx.execute(sql`select set_config('app.actor_kind', 'system', true)`)

      const steps = includeDemo ? [...REFERENCE_STEPS, DEMO_STEP] : REFERENCE_STEPS

      for (const step of steps) {
        const stepStarted = Date.now()
        const ctx: SeedContext = {
          tx: tx as unknown as SeedContext['tx'],
          includeDemo,
          log: (message) => console.log(`  [${step.name}] ${message}`),
        }
        console.log(`▸ ${step.name}`)
        await step.run(ctx)
        console.log(`  ✓ ${step.name} (${Date.now() - stepStarted}ms)`)
      }
    })
  } catch (error) {
    failed = true
    console.error('\n✖ Seeding failed — the transaction was rolled back.\n')
    console.error(error)
  } finally {
    await client.end({ timeout: 5 })
  }

  if (failed) process.exit(1)
  console.log(`\n✓ Seeding complete in ${Date.now() - started}ms`)
}

void main()
