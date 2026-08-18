import { sql } from 'drizzle-orm'
import type { Tx } from '../client'

/**
 * Postgres advisory locks.
 *
 * Used where a check-and-act sequence would otherwise race:
 *
 *   • CAPACITY RESERVATION (M12) — two officers approving delivery requests for the same
 *     room at the same instant must not both succeed. "SELECT available; if ok INSERT" is
 *     a race, and it is the kind that surfaces once a year at the worst moment.
 *
 *   • DOCUMENT NUMBERING (M06) — the series must be gapless. A gap in a legally
 *     significant series invites the question "where is GRN-2026-000412?"
 *
 * Advisory locking is cheaper than SELECT ... FOR UPDATE across a subtree and does not
 * depend on which rows the query happened to touch.
 *
 * ALL locks here are TRANSACTION-scoped (`_xact_`): they release automatically at commit
 * or rollback. A session-scoped lock on a pooled connection would leak into the next
 * request and eventually deadlock the plant.
 */

/** Lock namespaces. Keeps unrelated subsystems from colliding on a hashed key. */
export const LOCK_NAMESPACE = {
  CAPACITY: 1,
  NUMBER_SERIES: 2,
  STOCK_BALANCE: 3,
  JOB_QUEUE_LEADER: 4,
  BAG_STOCK: 5,
} as const

export type LockNamespace = (typeof LOCK_NAMESPACE)[keyof typeof LOCK_NAMESPACE]

/**
 * Take a transaction-scoped advisory lock and hold it until the transaction ends.
 * Blocks until acquired.
 *
 * Uses the two-int form: (namespace, hashtext(key)). Two-int keys make collisions between
 * subsystems impossible, which the single-bigint form does not.
 */
export async function acquireAdvisoryLock(
  tx: Tx,
  namespace: LockNamespace,
  key: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${namespace}::int, hashtext(${key})::int)`)
}

/**
 * Try to take the lock without blocking. Returns false if another transaction holds it.
 * Used by the worker's leader election, where waiting is pointless.
 */
export async function tryAdvisoryLock(
  tx: Tx,
  namespace: LockNamespace,
  key: string,
): Promise<boolean> {
  const result = await tx.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock(${namespace}::int, hashtext(${key})::int) as locked`,
  )
  const row = (result as unknown as Array<{ locked: boolean }>)[0]
  return row?.locked === true
}

/** Serialise capacity checks for one room (M12). */
export async function lockRoomCapacity(tx: Tx, roomId: string): Promise<void> {
  await acquireAdvisoryLock(tx, LOCK_NAMESPACE.CAPACITY, `room:${roomId}`)
}

/** Serialise number allocation for one series (M06). */
export async function lockNumberSeries(tx: Tx, seriesCode: string): Promise<void> {
  await acquireAdvisoryLock(tx, LOCK_NAMESPACE.NUMBER_SERIES, `series:${seriesCode}`)
}
