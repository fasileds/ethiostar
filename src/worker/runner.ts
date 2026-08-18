import { withServiceDb, type Tx } from '@db/client'
import { logger } from '@core/logging/logger'
import { SYSTEM_ACTOR_ID } from '@modules/identity'
import {
  claimJobs,
  completeJob,
  failJob,
  reclaimStaleJobs,
  type ClaimedJob,
} from '@platform/queue/postgres-queue'
import { JOB_HANDLERS } from './handlers'
import { runSweeps } from './sweeps'

/**
 * The poll loop.
 *
 * Each iteration claims a batch, runs the handlers, and records the outcome. Claiming uses
 * FOR UPDATE SKIP LOCKED, so several worker instances can run with no coordination.
 *
 * Handlers must be IDEMPOTENT: at-least-once delivery is the contract, and pretending
 * otherwise produces duplicate emails to customers.
 */

export interface WorkerOptions {
  readonly workerId: string
  readonly pollIntervalMs: number
  readonly batchSize: number
}

/** How long a CLAIMED job may sit before it is presumed abandoned by a dead worker. */
const STALE_CLAIM_SECONDS = 300
/** Reclaim sweep interval, in loop iterations. */
const RECLAIM_EVERY = 30

let shuttingDown = false

export function requestShutdown(): void {
  shuttingDown = true
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function runOne(job: ClaimedJob): Promise<void> {
  const log = logger.child({
    jobId: job.id,
    jobType: job.jobType,
    attempt: job.attempts + 1,
    correlationId: job.correlationId,
  })

  const handler = JOB_HANDLERS[job.jobType]

  if (!handler) {
    // An unknown type means a deploy removed a handler while jobs were queued. Dead-letter
    // it rather than retrying forever against code that no longer exists.
    log.error('no handler registered for job type — dead-lettering')
    await withServiceDb(SYSTEM_ACTOR_ID, `job:${job.jobType}:unknown`, (tx: Tx) =>
      failJob(tx, { ...job, attempts: job.maxAttempts - 1 }, 'No handler registered'),
    )
    return
  }

  const startedAt = performance.now()

  try {
    await handler({ payload: job.payload, correlationId: job.correlationId, log })

    await withServiceDb(SYSTEM_ACTOR_ID, `job:${job.jobType}:complete`, (tx: Tx) =>
      completeJob(tx, job.id),
    )

    log.info({ durationMs: Math.round(performance.now() - startedAt) }, 'job done')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    const outcome = await withServiceDb(SYSTEM_ACTOR_ID, `job:${job.jobType}:fail`, (tx: Tx) =>
      failJob(tx, job, message),
    )

    if (outcome === 'DEAD') {
      // Not a warning: dead-lettered work is work the business expected to happen.
      log.error({ err: message }, 'job dead-lettered after exhausting attempts')
    } else {
      log.warn({ err: message }, 'job failed — will retry')
    }
  }
}

export async function runWorkerLoop(options: WorkerOptions): Promise<void> {
  const { workerId, pollIntervalMs, batchSize } = options
  let iteration = 0

  while (!shuttingDown) {
    iteration += 1

    try {
      // Periodically release jobs a crashed worker left CLAIMED forever.
      if (iteration % RECLAIM_EVERY === 1) {
        const reclaimed = await withServiceDb(SYSTEM_ACTOR_ID, 'job:reclaim-stale', (tx: Tx) =>
          reclaimStaleJobs(tx, STALE_CLAIM_SECONDS),
        )
        if (reclaimed > 0) {
          logger.warn({ reclaimed }, 'reclaimed stale jobs from a dead worker')
        }
      }

      // Continuous work first: the outbox and the notification queue fill as a side effect
      // of ordinary business writes, so nothing ever enqueues a job to drain them.
      await runSweeps()

      const jobs = await withServiceDb(SYSTEM_ACTOR_ID, 'job:claim', (tx: Tx) =>
        claimJobs(tx, workerId, batchSize),
      )

      if (jobs.length === 0) {
        await sleep(pollIntervalMs)
        continue
      }

      // Sequential within a batch: it keeps ordering predictable and connection use
      // bounded. Throughput comes from running more worker instances, which SKIP LOCKED
      // makes free.
      for (const job of jobs) {
        if (shuttingDown) {
          logger.info({ jobId: job.id }, 'shutdown requested — leaving job for next worker')
          break
        }
        await runOne(job)
      }
    } catch (error) {
      // A loop-level failure is usually the database being unreachable. Back off rather
      // than spinning.
      logger.error({ err: error }, 'worker loop iteration failed')
      await sleep(Math.min(pollIntervalMs * 5, 30_000))
    }
  }

  logger.info('worker loop exiting cleanly')
}
