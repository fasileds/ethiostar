import { defineStateMachine, type TransitionTable } from '@core/domain/state-machine'

/** The release-request lifecycle. */
export const RELEASE_REQUEST_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'DISPATCHED',
  'CANCELLED',
] as const
export type ReleaseRequestStatus = (typeof RELEASE_REQUEST_STATUSES)[number]

export const RELEASE_REQUEST_TRANSITIONS: TransitionTable<ReleaseRequestStatus> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['DISPATCHED', 'CANCELLED'],
  REJECTED: [],
  DISPATCHED: [],
  CANCELLED: [],
}

export const releaseRequestStateMachine = defineStateMachine<ReleaseRequestStatus>(
  'release_request',
  RELEASE_REQUEST_TRANSITIONS,
)

/** The dispatch-order lifecycle, matching the schema's check constraint. */
export const DISPATCH_ORDER_STATUSES = [
  'PLANNED',
  'LOADING',
  'LOADED',
  'GATE_CLEARED',
  'DISPATCHED',
  'CANCELLED',
] as const
export type DispatchOrderStatus = (typeof DISPATCH_ORDER_STATUSES)[number]

export const DISPATCH_ORDER_TRANSITIONS: TransitionTable<DispatchOrderStatus> = {
  PLANNED: ['LOADING', 'CANCELLED'],
  LOADING: ['LOADED', 'CANCELLED'],
  LOADED: ['GATE_CLEARED', 'CANCELLED'],
  GATE_CLEARED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: [],
  CANCELLED: [],
}

export const dispatchOrderStateMachine = defineStateMachine<DispatchOrderStatus>(
  'dispatch_order',
  DISPATCH_ORDER_TRANSITIONS,
)
