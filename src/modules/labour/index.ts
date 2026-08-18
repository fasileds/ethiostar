/** M18 — Casual Labour & Piece-Rate Payment. */
export {
  calculateEarnings,
  assertCorrectionIsValid,
  voucherTotal,
  type SplitMethod,
  type PieceRateVersion,
  type GangMember,
  type EarningsInput,
  type EarningsResult,
  type WorkerEarning,
  type LabourCorrection,
} from './domain/piece-rate'

export {
  listWorkers,
  listLabourOutputs,
  labourOutputStatusCounts,
  attendanceForDay,
  labourDaySummary,
  listCrews,
  type WorkerRow,
  type LabourOutputRow,
  type AttendanceRow,
  type CrewRow,
} from './application/labour.query'

export {
  insertWorker,
  insertCrew,
  addCrewMember,
  crewMemberIds,
  findActiveRate,
  type CreateWorkerInput,
} from './infrastructure/labour.repository'

export {
  recordCrewOutput,
  approveLabourOutput,
  type RecordCrewOutputInput,
} from './application/record-crew-output'

export {
  loadLabourVoucherSnapshot,
  type LabourVoucherSnapshot,
  type LabourVoucherWorkerLine,
} from './application/labour-voucher-print-snapshot'

export {
  listLabourRates,
  listRatesForKey,
  addLabourRate,
  listLabourActivityTypes,
  listBranchesForLabourRate,
  type LabourRateRow,
  type AddLabourRateInput,
  type LabourActivityTypeOption,
  type BranchOption,
} from './infrastructure/labour-rate-admin.repository'
