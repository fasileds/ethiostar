/**
 * The consignment spine — the operational backbone shared by M11–M17.
 *
 * "a single consignment reference [that] follows the coffee from the customer's request
 * letter, through the store rooms and sections it occupies, into the processing line, out
 * into four graded outputs, and onto the dispatch truck."
 */

export {
  consignmentStateMachine,
  lotStateMachine,
  CONSIGNMENT_STATUSES,
  CONSIGNMENT_TRANSITIONS,
  LOT_STATUSES,
  LOT_TRANSITIONS,
  IN_CUSTODY_STATUSES,
  TERMINAL_STATUSES,
  deriveConsignmentStatus,
  isInCustody,
  isTerminal,
  type ConsignmentStatus,
  type LotStatus,
} from './domain/consignment.state-machine'

export {
  listConsignments,
  consignmentStatusCounts,
  findConsignment,
  consignmentLots,
  type ConsignmentRow,
  type ConsignmentDetail,
  type LotRow,
} from './application/consignment.query'

export {
  createConsignment,
  transitionConsignment,
  recordConsignmentReceipt,
  markConsignmentClosed,
  syncConsignmentStatusFromLots,
  type CreateConsignmentInput,
  type TransitionConsignmentInput,
  type RecordReceiptInput,
} from './infrastructure/consignment.repository'

export {
  createLot,
  transitionLot,
  upsertLotPlacement,
  removeLotPlacement,
  addLotLineage,
  type CreateLotInput,
  type TransitionLotInput,
} from './infrastructure/lot.repository'

export {
  consignmentStatusChanged,
  lotStatusChanged,
  lotCreated,
  type ConsignmentStatusChangedPayload,
  type LotStatusChangedPayload,
  type LotCreatedPayload,
} from './domain/events'

export {
  loadStorePlacementSnapshot,
  type StorePlacementSnapshot,
} from './application/store-placement-print-snapshot'
