import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { uuidv7 } from '@core/ids/id-generator'

/**
 * Postgres-backed job queue.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes running several worker instances safe with no
 * coordination service: each claims a disjoint set and a slow handler blocks nobody.
 *
 * Why not `after()`: it is best-effort and dies with the request. Right for fire-and-forget
 * logging, wrong for a notification the business must PROVE it sent — and M04's key control
 * makes the notification log an evidentiary record.
 *
 * docs/adr/0008-background-jobs.md
 */

export interface EnqueueOptions {
  readonly jobType: string
  readonly payload?: Record<string, unknown>
  readonly priority?: number
  readonly runAfter?: Date
  readonly maxAttempts?: number
  /** Enqueue-once. A retrying handler cannot create a duplicate. */
  readonly idempotencyKey?: string
  readonly correlationId?: string
}

export interface ClaimedJob {
  readonly id: string
  readonly jobType: string
  readonly payload: Record<string, unknown>
  readonly attempts: number
  readonly maxAttempts: number
  readonly correlationId: string | null
}

/**
 * Enqueue INSIDE the caller's transaction, so the job is rolled back with the business
 * change if that fails. Returns null when the idempotency key already exists.
 */
export async function enqueue(tx: Tx, options: EnqueueOptions): Promise<string | null> {
  const id = uuidv7()

  const result = await tx.execute(sql`
    insert into public.job_queue
      (id, job_type, payload, priority, run_after, max_attempts, idempotency_key, correlation_id)
    values (
      ${id},
      ${options.jobType},
      ${JSON.stringify(options.payload ?? {})}::jsonb,
      ${options.priority ?? 100},
      ${options.runAfter ?? sql`now()`},
      ${options.maxAttempts ?? 5},
      ${options.idempotencyKey ?? null},
      ${options.correlationId ?? null}
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing
    returning id
  `)

  const rows = result as unknown as Array<{ id: string }>
  return rows[0]?.id ?? null
}

/**
 * Claim a batch. The UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) shape is
 * deliberate: the inner select takes the locks, the outer update marks them claimed, and
 * both happen in one statement so no other worker can interleave.
 */
export async function claimJobs(
  tx: Tx,
  workerId: string,
  batchSize: number,
): Promise<ClaimedJob[]> {
  const result = await tx.execute(sql`
    update public.job_queue j
    set status = 'CLAIMED', claimed_by = ${workerId}, claimed_at = now()
    where j.id in (
      select id from public.job_queue
      where status = 'PENDING' and run_after <= now()
      order by priority, run_after
      for update skip locked
      limit ${batchSize}
    )
    returning j.id, j.job_type, j.payload, j.attempts, j.max_attempts, j.correlation_id
  `)

  const rows = result as unknown as Array<{
    id: string
    job_type: string
    payload: Record<string, unknown>
    attempts: number
    max_attempts: number
    correlation_id: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    jobType: row.job_type,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    correlationId: row.correlation_id,
  }))
}

export async function completeJob(tx: Tx, jobId: string): Promise<void> {
  await tx.execute(sql`
    update public.job_queue
    set status = 'DONE', completed_at = now()
    where id = ${jobId}
  `)
}

/**
 * Record a failure. Retries with exponential backoff plus FULL JITTER — synchronised
 * retries turn a transient spike into an outage.
 *
 * After `max_attempts` the job moves to DEAD and raises an alert rather than disappearing,
 * so failed work is visible in a table an operator can query.
 */
export async function failJob(
  tx: Tx,
  job: ClaimedJob,
  error: string,
): Promise<'RETRY' | 'DEAD'> {
  const nextAttempt = job.attempts + 1

  if (nextAttempt >= job.maxAttempts) {
    await tx.execute(sql`
      update public.job_queue
      set status = 'DEAD', attempts = ${nextAttempt}, last_error = ${error.slice(0, 2000)}
      where id = ${job.id}
    `)
    return 'DEAD'
  }

  const ceilingSeconds = Math.min(2 ** nextAttempt, 600)
  const delaySeconds = Math.floor(Math.random() * ceilingSeconds) + 1

  await tx.execute(sql`
    update public.job_queue
    set status = 'PENDING',
        attempts = ${nextAttempt},
        last_error = ${error.slice(0, 2000)},
        claimed_by = null,
        claimed_at = null,
        run_after = now() + make_interval(secs => ${delaySeconds})
    where id = ${job.id}
  `)
  return 'RETRY'
}

/**
 * Release jobs claimed by a worker that died without completing them.
 * Without this, a crashed worker's in-flight jobs stay CLAIMED forever.
 */
export async function reclaimStaleJobs(tx: Tx, staleAfterSeconds: number): Promise<number> {
  const result = await tx.execute(sql`
    update public.job_queue
    set status = 'PENDING', claimed_by = null, claimed_at = null
    where status = 'CLAIMED'
      and claimed_at < now() - make_interval(secs => ${staleAfterSeconds})
    returning id
  `)
  return (result as unknown as unknown[]).length
}

export interface QueueDepth {
  readonly jobType: string
  readonly status: string
  readonly count: number
}

/** Queue depth by type and status — the metric to alert on. */
export async function queueDepth(tx: Tx): Promise<QueueDepth[]> {
  const result = await tx.execute(sql`
    select job_type, status, count(*)::int as count
    from public.job_queue
    where status in ('PENDING','CLAIMED','DEAD')
    group by job_type, status
  `)

  const rows = result as unknown as Array<{ job_type: string; status: string; count: number }>
  return rows.map((row) => ({ jobType: row.job_type, status: row.status, count: row.count }))
}
