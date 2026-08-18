import { defineStateMachine, type TransitionTable } from '@core/domain/state-machine'

/**
 * The delivery-request lifecycle, matching the schema's check constraint exactly:
 *
 *   DRAFT → SUBMITTED → APPROVED | REJECTED → SCHEDULED → ARRIVED → RECEIVED | CANCELLED
 *
 * Phase 1 actively drives DRAFT → SUBMITTED → APPROVED/REJECTED → RECEIVED (the goods
 * receipt posts straight through, combining what SCHEDULED/ARRIVED would otherwise track
 * separately — see review-application's scope note on the equivalent gap in M08). SCHEDULED
 * and ARRIVED stay reachable in the table so a later gate-in/appointment-linking feature can
 * use them without a migration.
 */
export const DELIVERY_REQUEST_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'SCHEDULED',
  'ARRIVED',
  'RECEIVED',
  'CANCELLED',
] as const

export type DeliveryRequestStatus = (typeof DELIVERY_REQUEST_STATUSES)[number]

export const DELIVERY_REQUEST_TRANSITIONS: TransitionTable<DeliveryRequestStatus> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'ARRIVED', 'RECEIVED', 'CANCELLED'],
  REJECTED: [],
  SCHEDULED: ['ARRIVED', 'RECEIVED', 'CANCELLED'],
  ARRIVED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
}

export const deliveryRequestStateMachine = defineStateMachine<DeliveryRequestStatus>(
  'delivery_request',
  DELIVERY_REQUEST_TRANSITIONS,
)
