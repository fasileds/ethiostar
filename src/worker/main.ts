/**
 * Background worker entry point.
 *
 * A SEPARATE PROCESS from the web tier, same codebase, same container image, different
 * entrypoint — so there is no drift between what the web tier believes and what the worker
 * believes.
 *
 * It connects with `service_role` because it has no user context. That is one of the three
 * sanctioned uses in docs/adr/0013; every job that writes still sets an explicit system
 * actor so the audit trigger can attribute it.
 *
 * Run: npm run worker   (dev: npm run dev:worker)
 */
import { randomUUID } from 'node:crypto'
import { loadEnv } from '@config/env'
import { configureLogger, logger } from '@core/logging/logger'
import { closeDatabase } from '@db/client'
import { runWorkerLoop, requestShutdown } from './runner'

/** Identifies this instance in `job_queue.claimed_by`, so a stale claim can be traced. */
const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`

async function main(): Promise<void> {
  // Fail to START on a bad configuration, not on the first job that needs SMTP_HOST.
  const env = loadEnv()

  configureLogger({
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
    service: 'cpms-worker',
  })

  logger.info(
    {
      workerId: WORKER_ID,
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      batchSize: env.WORKER_BATCH_SIZE,
      concurrency: env.WORKER_CONCURRENCY,
    },
    'CPMS worker starting',
  )

  installShutdownHandlers()

  await runWorkerLoop({
    workerId: WORKER_ID,
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    batchSize: env.WORKER_BATCH_SIZE,
  })

  logger.info({ workerId: WORKER_ID }, 'worker loop ended; closing connections')
  await closeDatabase()
  process.exit(0)
}

/**
 * Graceful shutdown: stop claiming, finish in-flight work, then exit.
 *
 * Without this, a rolling deploy kills a worker mid-job. The job would eventually be
 * reclaimed as stale, but a partially-sent notification batch is exactly the kind of thing
 * that produces a duplicate email to a customer.
 */
function installShutdownHandlers(): void {
  let shuttingDown = false

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      logger.warn({ signal }, 'second signal received — forcing exit')
      process.exit(1)
    }
    shuttingDown = true
    logger.info({ signal }, 'shutdown requested — draining in-flight jobs')
    requestShutdown()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled rejection in worker')
  })

  process.on('uncaughtException', (error) => {
    logger.error({ err: error }, 'uncaught exception in worker — exiting')
    process.exit(1)
  })
}

void main().catch((error: unknown) => {
  // The logger may not be configured yet if loadEnv() threw.
  console.error('Worker failed to start:', error)
  process.exit(1)
})
