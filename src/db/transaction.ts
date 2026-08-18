import 'server-only'
import { withAuthenticatedDb, type DbClaims, type Tx } from './client'

/**
 * Unit of Work — one transaction per use case.
 *
 * Rules this enforces (docs/architecture/06-cross-cutting.md §6.3):
 *   1. One transaction per use case, not per repository call. Repositories accept `tx`;
 *      they never open their own.
 *   2. The audit event and the business change share the transaction. That atomicity is
 *      what makes the audit trail trustworthy.
 *   3. NO I/O inside a transaction — no email, no storage, no PDF, no HTTP. Those go to
 *      the outbox and run after commit. A PDF render inside a transaction holds row locks
 *      for the duration of a rendering engine's startup, which is how a plant stalls.
 *   4. Serialization failures retry with jittered backoff rather than surfacing as an
 *      error the user cannot act on.
 */

/** Postgres error codes worth retrying. */
const RETRYABLE_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
])

export interface UnitOfWorkOptions {
  /** Attempts including the first. */
  readonly maxAttempts?: number
  readonly baseDelayMs?: number
}

function isRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && RETRYABLE_CODES.has(code)
}

function backoffDelay(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1)
  // Full jitter — synchronised retries are how a transient contention spike becomes an
  // outage.
  return Math.floor(Math.random() * exponential)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run a use case in one transaction, as the given actor, with RLS enforced.
 *
 * `fn` must be IDEMPOTENT with respect to its own side effects, because it may be retried.
 * That is safe by construction here: side effects go to the outbox, which is written inside
 * the same transaction and therefore rolled back with it.
 */
export async function runInTransaction<T>(
  claims: DbClaims,
  fn: (tx: Tx) => Promise<T>,
  options: UnitOfWorkOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  const baseDelayMs = options.baseDelayMs ?? 25

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await withAuthenticatedDb(claims, fn)
    } catch (error) {
      lastError = error
      if (!isRetryable(error) || attempt === maxAttempts) throw error
      await sleep(backoffDelay(attempt, baseDelayMs))
    }
  }

  throw lastError
}

/** Exported for tests that need to assert the retry classification. */
export const __testing = { isRetryable, backoffDelay, RETRYABLE_CODES }
