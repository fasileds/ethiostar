import 'server-only'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { env, isDevelopment } from '@config/env'
import * as schema from './schema'

/**
 * THE ONLY PLACE A DATABASE CONNECTION IS CREATED.
 *
 * Two paths, and the difference between them is the difference between RLS being enforced
 * and RLS being decorative:
 *
 *   withAuthenticatedDb()  DEFAULT. Runs as `authenticated` with the caller's JWT claims set
 *                          per transaction, exactly reproducing what PostgREST does — so
 *                          auth.uid() and auth.jwt() resolve inside policies.
 *
 *   withServiceDb()        PRIVILEGED. Runs as the connection's owner and BYPASSES RLS
 *                          completely. NOT exported from the module barrel. Confined to
 *                          three sanctioned uses and enforced by scripts/guard-service-role.ts.
 *
 * docs/adr/0013-supabase-as-database-platform.md
 * docs/architecture/04-database-and-migrations.md §4.0
 */

export type Database = PostgresJsDatabase<typeof schema>
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Claims the database needs in order to evaluate policies.
 * Mirrors the Supabase JWT shape; `sub` is what auth.uid() reads.
 */
export interface DbClaims {
  /** auth.users.id — becomes auth.uid(). */
  readonly sub: string
  /** Postgres role to assume. Never `service_role` on this path. */
  readonly role: 'authenticated' | 'anon'
  readonly actor_kind?: 'staff' | 'customer'
  readonly customer_id?: string | null
  /**
   * REQUIRED for any staff-gated policy. `fn_is_staff()` is
   *   actor_kind = 'staff' AND status = 'ACTIVE'
   * so omitting this makes every staff policy deny, however correct actor_kind is.
   */
  readonly status?: string
  readonly permissions_version?: number
  readonly aal?: 'aal1' | 'aal2'
  readonly [key: string]: unknown
}

/** Anonymous claims for the public application form and other unauthenticated routes. */
export const ANON_CLAIMS: DbClaims = { sub: '', role: 'anon' }

// ── Connection management ────────────────────────────────────────────────────

declare global {
  var __cpms_pool: postgres.Sql | undefined
  var __cpms_service_pool: postgres.Sql | undefined
}

function createPool(connectionString: string, max: number): postgres.Sql {
  return postgres(connectionString, {
    max,
    // REQUIRED on the Supavisor transaction pooler (port 6543): connections are
    // reassigned between queries, so a named prepared statement issued on one may not
    // exist on the next. Omitting this produces intermittent, confusing failures.
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    // Every process runs in UTC; business dates are converted in core/utils/date.ts.
    types: {},
    connection: {
      application_name: 'cpms',
      statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
      TimeZone: 'UTC',
    },
    // Suppress notice spam outside development. `exactOptionalPropertyTypes` forbids an
    // explicit `undefined` here, so the key is spread in conditionally.
    ...(isDevelopment() ? {} : { onnotice: () => {} }),
  })
}

/**
 * Memoised on globalThis in development so Turbopack HMR does not exhaust the connection
 * budget — a classic Next.js foot-gun that bites sooner against Supabase's limits.
 */
function pool(): postgres.Sql {
  if (isDevelopment()) {
    globalThis.__cpms_pool ??= createPool(env.DATABASE_URL, env.DATABASE_POOL_MAX)
    return globalThis.__cpms_pool
  }
  poolSingleton ??= createPool(env.DATABASE_URL, env.DATABASE_POOL_MAX)
  return poolSingleton
}

let poolSingleton: postgres.Sql | undefined
let servicePoolSingleton: postgres.Sql | undefined

function servicePool(): postgres.Sql {
  if (isDevelopment()) {
    globalThis.__cpms_service_pool ??= createPool(env.DIRECT_URL, 5)
    return globalThis.__cpms_service_pool
  }
  servicePoolSingleton ??= createPool(env.DIRECT_URL, 5)
  return servicePoolSingleton
}

/**
 * Drizzle's postgres-js adapter neuters postgres.js's own date serializer on every
 * `drizzle(client, ...)` call — it replaces the timestamptz/timestamp/date serializers with
 * an identity function, because Drizzle's schema-typed queries (`db.insert(table).values(…)`)
 * convert `Date` to text themselves via the column encoder before the value ever reaches
 * postgres.js. That's invisible for typed queries, but every raw `sql\`...\`` query in this
 * codebase (which is most of them — see docs/adr/0013) interpolates a plain `Date` with no
 * encoder in between, and postgres.js then tries to wire-encode the untouched `Date` object
 * and throws `ERR_INVALID_ARG_TYPE`. Restoring the real serializer is safe for the typed path
 * too: it round-trips an already-ISO string straight back through `new Date(x).toISOString()`.
 */
function restoreDateSerializers(client: postgres.Sql): void {
  const serialize = (x: unknown): string =>
    (x instanceof Date ? x : new Date(x as string)).toISOString()
  for (const oid of [1184, 1082, 1114]) {
    client.options.serializers[oid] = serialize
  }
}

function db(): Database {
  const client = pool()
  const instance = drizzle(client, { schema, logger: false })
  restoreDateSerializers(client)
  return instance
}

// ── The default path: RLS enforced ───────────────────────────────────────────

/**
 * Run `fn` inside a transaction whose JWT context makes RLS apply.
 *
 * `set_config(..., true)` and `set local role` are TRANSACTION-SCOPED. That is not a
 * detail: under Supavisor transaction pooling, session-scoped state survives into the next
 * request on the same connection, which would be a cross-tenant data leak.
 *
 * A query issued OUTSIDE a transaction gets no JWT context and is evaluated as anonymous —
 * it fails closed, but confusingly, which is why every RLS-scoped read goes through here.
 */
export async function withAuthenticatedDb<T>(
  claims: DbClaims,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (claims.role === 'authenticated' && !claims.sub) {
    throw new Error('withAuthenticatedDb requires a subject for the `authenticated` role')
  }

  return db().transaction(async (tx) => {
    await applyRequestContext(tx, claims)
    return fn(tx)
  })
}

/**
 * Set the per-transaction context that both RLS policies and the audit trigger read.
 *
 *   request.jwt.claims / request.jwt.claim.sub  → auth.uid(), auth.jwt()
 *   app.actor_id                                → fn_audit_row() attribution
 *   set local role                              → which policies apply
 */
async function applyRequestContext(tx: Tx, claims: DbClaims): Promise<void> {
  const serialised = JSON.stringify(claims)

  // Parameterised — never interpolated. Identifier interpolation in this exact position
  // is the shape of GHSA-gpj5-g38j-94v9.
  await tx.execute(sql`select set_config('request.jwt.claims', ${serialised}, true)`)
  await tx.execute(sql`select set_config('request.jwt.claim.sub', ${claims.sub}, true)`)
  await tx.execute(sql`select set_config('app.actor_id', ${claims.sub}, true)`)
  await tx.execute(sql`select set_config('app.actor_kind', ${claims.actor_kind ?? ''}, true)`)

  // `SET LOCAL ROLE` cannot be parameterised, so the value is constrained to a closed
  // allow-list rather than passed through from the caller.
  if (claims.role === 'authenticated') {
    await tx.execute(sql`set local role authenticated`)
  } else {
    await tx.execute(sql`set local role anon`)
  }
}

/** Read-only convenience over `withAuthenticatedDb`. */
export async function queryAs<T>(claims: DbClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withAuthenticatedDb(claims, fn)
}

// ── The privileged path: RLS BYPASSED ────────────────────────────────────────

/**
 * Runs with RLS BYPASSED. Sanctioned uses only:
 *   1. migrations (Supabase CLI — not this function)
 *   2. the background worker, which has no user context
 *   3. `<module>/infrastructure/system/` for operations with no acting user
 *
 * `systemActorId` is mandatory so the audit trigger can still attribute the write —
 * an un-attributed write must remain impossible even on the privileged path.
 *
 * NOT exported from src/db/index.ts. Import sites are allow-listed in
 * scripts/guard-service-role.ts and adding one requires a reviewer to agree.
 */
export async function withServiceDb<T>(
  systemActorId: string,
  reason: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!systemActorId) {
    throw new Error('withServiceDb requires a system actor id for audit attribution')
  }
  if (!reason) {
    throw new Error('withServiceDb requires a stated reason — it appears in the audit log')
  }

  const serviceClient = servicePool()
  const serviceDb = drizzle(serviceClient, { schema, logger: false })
  restoreDateSerializers(serviceClient)

  return serviceDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.actor_id', ${systemActorId}, true)`)
    await tx.execute(sql`select set_config('app.actor_kind', 'system', true)`)
    await tx.execute(sql`select set_config('app.system_reason', ${reason}, true)`)
    return fn(tx)
  })
}

/** Close pools on shutdown. Called by the worker's SIGTERM handler. */
export async function closeDatabase(): Promise<void> {
  await Promise.allSettled([
    poolSingleton?.end({ timeout: 5 }),
    servicePoolSingleton?.end({ timeout: 5 }),
    globalThis.__cpms_pool?.end({ timeout: 5 }),
    globalThis.__cpms_service_pool?.end({ timeout: 5 }),
  ])
}

/** Readiness probe. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await db().execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}
