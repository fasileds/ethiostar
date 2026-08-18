import { logger, type Logger } from '@core/logging/logger'
import { systemClock } from '@core/clock/clock'
import { relayOutbox } from './handlers/relay-outbox.handler'
import { sendNotifications } from './handlers/send-notification.handler'
import { balanceReconciliation } from './handlers/balance-reconciliation.handler'
import { reservationExpiryScan } from './handlers/reservation-expiry-scan.handler'
import type { JobContext } from './handlers/types'

/**
 * Recurring sweeps — work that must happen continuously rather than being enqueued by
 * somebody.
 *
 * The outbox relay and the notification sender are not jobs anyone schedules: they drain
 * queues that fill as a side effect of ordinary business writes. Registering them only in
 * `JOB_HANDLERS` left them unreachable — no code path ever inserted a `relay-outbox` row,
 * so the outbox would have grown without ever being published and no customer would have
 * been notified of anything.
 *
 * NO LEADER ELECTION IS NEEDED. Both sweeps claim their work with `FOR UPDATE SKIP LOCKED`
 * and flip a status inside the claiming transaction, so N workers take disjoint batches.
 * Adding an advisory lock here would serialise the very thing that is safe to parallelise.
 *
 * A sweep that throws is logged and skipped; the next iteration retries. One failing sweep
 * must not stop the other, and neither must stop the queued-job loop.
 */

interface Sweep {
  readonly name: string
  readonly run: (ctx: JobContext) => Promise<void>
}

const SWEEPS: readonly Sweep[] = [
  { name: 'relay-outbox', run: relayOutbox },
  { name: 'send-notification', run: sendNotifications },
  { name: 'reservation-expiry-scan', run: reservationExpiryScan },
]

/**
 * Balance reconciliation scans the whole ledger and is not something to run on every poll
 * tick — there is no cron scheduler wired up yet (that is M23's `scheduled_task` table,
 * Step 23), so this is the interim mechanism: a wall-clock throttle inside the loop that
 * already runs continuously.
 */
const RECONCILE_EVERY_MS = 30 * 60 * 1000
let lastReconciledAt = 0

export async function runSweeps(log: Logger = logger): Promise<void> {
  for (const sweep of SWEEPS) {
    try {
      await sweep.run({
        payload: {},
        correlationId: null,
        log: log.child({ sweep: sweep.name }),
      })
    } catch (error) {
      log.error({ sweep: sweep.name, err: error }, 'sweep failed — will retry next iteration')
    }
  }

  const now = systemClock.now().getTime()
  if (now - lastReconciledAt >= RECONCILE_EVERY_MS) {
    lastReconciledAt = now
    try {
      await balanceReconciliation({
        payload: {},
        correlationId: null,
        log: log.child({ sweep: 'balance-reconciliation' }),
      })
    } catch (error) {
      log.error({ sweep: 'balance-reconciliation', err: error }, 'reconciliation sweep failed')
    }
  }
}
