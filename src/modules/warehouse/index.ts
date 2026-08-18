/**
 * M12 — Warehouse, Room & Section Management.
 *
 * "It answers the two questions that stop the business when they cannot be answered:
 * 'where is it?' and 'will it fit?'"
 */

export {
  computeAvailable,
  checkFit,
  assertFits,
  rollUp,
  type CapacityFigures,
  type AvailableCapacity,
  type CapacityRequest,
  type CapacityCheckResult,
} from './domain/capacity'

export {
  BestFitPlacementStrategy,
  proposalTotals,
  type PlacementStrategy,
  type PlacementContext,
  type PlacementProposal,
  type PlacementLine,
  type CandidateLocation,
} from './domain/placement'

export {
  warehouseTree,
  activeReservations,
  type WarehouseTree,
  type WarehouseTreeRoom,
  type SectionCapacity,
  type ReservationRow,
} from './application/warehouse.query'

export { sectionFigures } from './infrastructure/capacity.repository'

export {
  findActiveReservationForRequest,
  consumeReservation,
  releaseReservation,
  expireReservations,
} from './infrastructure/capacity.repository'

export { reserveIfFits, checkAvailability } from './application/reserve-if-fits'

export { findLossAccountSection } from './infrastructure/loss-account.repository'

export {
  listBranches,
  warehouseAdminTree,
  createWarehouse,
  createRoom,
  createSection,
  setWarehouseActive,
  setRoomActive,
  setSectionActive,
  type BranchOption,
  type AdminWarehouseRow,
  type AdminRoomRow,
  type AdminSectionRow,
  type CreateWarehouseInput,
  type CreateRoomInput,
  type CreateSectionInput,
} from './infrastructure/warehouse-admin.repository'
