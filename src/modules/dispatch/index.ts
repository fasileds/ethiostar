/** M17 — Outbound Dispatch, Gate Pass & Delivery. */
export {
  evaluateClearance,
  assertClearedForDispatch,
  assertGatePassUsable,
  checkGatePass,
  registrationsMatch,
  type ReleaseLot,
  type HoldReason,
  type ClearanceInput,
  type ClearanceResult,
  type GatePass,
  type GatePassStatus,
  type GateOutAttempt,
} from './domain/clearance'

export {
  listReleaseRequests,
  listDispatchOrders,
  dispatchStatusCounts,
  gateQueue,
  dispatchLines,
  recentGateEvents,
  vehiclesOnSite,
  type ReleaseRequestRow,
  type DispatchOrderRow,
  type GateQueueEntry,
  type DispatchLineRow,
  type GateEventRow,
  type OnSiteVehicle,
} from './application/dispatch.query'

export {
  RELEASE_REQUEST_STATUSES,
  releaseRequestStateMachine,
  DISPATCH_ORDER_STATUSES,
  dispatchOrderStateMachine,
  type ReleaseRequestStatus,
  type DispatchOrderStatus,
} from './domain/dispatch-status'

export {
  submitReleaseRequest,
  rejectReleaseRequest,
  approveReleaseRequest,
} from './application/release-request'

export type { CreateReleaseRequestInput } from './infrastructure/release-request.repository'

export {
  loadDispatch,
  clearForGate,
  recordGateOut,
  type LoadDispatchInput,
} from './application/load-and-dispatch'

export type { DispatchLineInput } from './infrastructure/dispatch-order.repository'

export {
  loadReleaseRequestSnapshot,
  type ReleaseRequestSnapshot,
} from './application/release-request-print-snapshot'

export {
  loadLoadingListSnapshot,
  type LoadingListLine,
  type LoadingListSnapshot,
} from './application/loading-list-print-snapshot'

export {
  loadDispatchNoteSnapshot,
  type DispatchNoteLine,
  type DispatchNoteSnapshot,
} from './application/dispatch-note-print-snapshot'

export {
  loadGatePassSnapshot,
  type GatePassSnapshot,
} from './application/gate-pass-print-snapshot'
