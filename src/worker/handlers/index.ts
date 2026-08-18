import { relayOutbox } from './relay-outbox.handler'
import { sendNotifications } from './send-notification.handler'
import { balanceReconciliation } from './balance-reconciliation.handler'
import { reservationExpiryScan } from './reservation-expiry-scan.handler'
import { JOB_TYPES, type JobHandler } from './types'

/**
 * The job handler registry.
 *
 * Every handler MUST be idempotent — at-least-once delivery is the contract, so a handler
 * that sends an email must check whether it already did.
 *
 * Types live in ./types.ts, not here: this file imports every handler, so a handler
 * importing back from here would close a dependency cycle.
 */

export { JOB_TYPES, type JobContext, type JobHandler, type JobType } from './types'

export const JOB_HANDLERS: Readonly<Record<string, JobHandler>> = {
  [JOB_TYPES.RELAY_OUTBOX]: relayOutbox,
  [JOB_TYPES.SEND_NOTIFICATION]: sendNotifications,
  [JOB_TYPES.BALANCE_RECONCILIATION]: balanceReconciliation,
  [JOB_TYPES.RESERVATION_EXPIRY_SCAN]: reservationExpiryScan,
  // Registered as each roadmap step lands:
  // [JOB_TYPES.RENDER_DOCUMENT]:          renderDocument,          // Step 12
  // [JOB_TYPES.SCAN_FILE]:                scanFile,                // Step 10
  // [JOB_TYPES.DOCUMENT_EXPIRY_SCAN]:     documentExpiryScan,      // Step 14
  // [JOB_TYPES.CAPACITY_THRESHOLD_SCAN]:  capacityThresholdScan,   // Step 13
  // [JOB_TYPES.AGEING_STOCK_SCAN]:        ageingStockScan,         // Step 16
}
