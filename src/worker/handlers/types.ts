import type { Logger } from '@core/logging/logger'

/**
 * Job handler contract.
 *
 * Kept separate from `index.ts` so a handler can import its own types without creating a
 * cycle: `index.ts` imports every handler in order to register it, so a handler importing
 * from `index.ts` closes a loop. dependency-cruiser caught exactly that.
 */

export interface JobContext {
  readonly payload: Record<string, unknown>
  readonly correlationId: string | null
  readonly log: Logger
}

export type JobHandler = (ctx: JobContext) => Promise<void>

/**
 * Stable job-type identifiers.
 *
 * Renaming one strands every queued job of that type — the worker would dead-letter them
 * as "no handler registered". Treat this as append-only.
 */
export const JOB_TYPES = {
  RELAY_OUTBOX: 'relay-outbox',
  SEND_NOTIFICATION: 'send-notification',
  RENDER_DOCUMENT: 'render-document',
  SCAN_FILE: 'scan-file',
  DOCUMENT_EXPIRY_SCAN: 'document-expiry-scan',
  CAPACITY_THRESHOLD_SCAN: 'capacity-threshold-scan',
  AGEING_STOCK_SCAN: 'ageing-stock-scan',
  RESERVATION_EXPIRY_SCAN: 'reservation-expiry-scan',
  BALANCE_RECONCILIATION: 'balance-reconciliation',
} as const

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES]
