import 'server-only'
import { cache } from 'react'
import { sql } from 'drizzle-orm'
import { withAuthenticatedDb, ANON_CLAIMS } from '@db/client'
import { logger } from '@core/logging/logger'

/**
 * Database readiness.
 *
 * The app is built before the database exists — migrations are applied separately, and on a
 * fresh clone `supabase start` may not have run yet. A page that throws a raw Postgres
 * error in that state teaches the developer nothing and makes the whole UI unreachable.
 *
 * So every data-backed page asks this first and renders a `<NotReady>` panel with the
 * actual commands instead. The chrome, navigation and layout all still render, which means
 * the interface is reviewable before a single row exists.
 *
 * This is NOT a fallback to fake data. Nothing invents a consignment. It is the difference
 * between "the database is not set up, here is how" and a stack trace.
 */

export type Readiness =
  | { readonly ready: true }
  | {
      readonly ready: false
      readonly reason: 'NO_CONNECTION' | 'NO_SCHEMA'
      readonly detail: string
    }

/**
 * Memoised per request by React `cache`, so a page with six data regions checks once.
 */
export const checkDatabase = cache(async (): Promise<Readiness> => {
  try {
    // `to_regclass` returns NULL rather than throwing when the table is absent, which
    // distinguishes "connected but not migrated" from "cannot connect" in one round trip.
    const result = await withAuthenticatedDb(ANON_CLAIMS, async (tx) =>
      tx.execute(sql`select to_regclass('public.consignment') is not null as has_schema`),
    )

    const rows = result as unknown as Array<{ has_schema: boolean }>

    if (rows[0]?.has_schema) return { ready: true }

    return {
      ready: false,
      reason: 'NO_SCHEMA',
      detail: 'Connected to Postgres, but the CPMS tables do not exist yet.',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn({ err: message }, 'database not reachable')

    return {
      ready: false,
      reason: 'NO_CONNECTION',
      detail: message,
    }
  }
})

/**
 * Run a query, or return a fallback when the database is not ready.
 *
 * Lets a page compose several regions where each degrades independently rather than the
 * whole route failing because one panel could not load.
 */
export async function queryOr<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  const readiness = await checkDatabase()
  if (!readiness.ready) return fallback

  try {
    return await run()
  } catch (error) {
    logger.error({ err: error }, 'page query failed')
    return fallback
  }
}
