/** M15 — Processing Execution & Output Classification. */
export {
  computeMassBalance,
  assertMayClose,
  varianceStatus,
  detectYieldOutliers,
  toYieldSnapshot,
  type OutputLine,
  type LossLine,
  type MassBalanceInput,
  type MassBalanceResult,
  type YieldLine,
  type YieldSnapshot,
  type CloseJobContext,
} from './domain/mass-balance'

export {
  listJobOrders,
  jobOrderStatusCounts,
  findJobOrder,
  jobInputs,
  jobOutputs,
  jobProductionLogs,
  listProcessingRequests,
  type JobOrderRow,
  type JobOrderDetail,
  type JobInputRow,
  type JobOutputRow,
  type ProductionLogRow,
  type ProcessingRequestRow,
} from './application/job-order.query'

export {
  JOB_ORDER_STATUSES,
  JOB_ORDER_TRANSITIONS,
  jobOrderStateMachine,
  type JobOrderStatus,
} from './domain/job-order-status'

export {
  insertJobOrder,
  lockJobOrder,
  transitionJobOrder,
  type CreateJobOrderInput,
} from './infrastructure/job-order.repository'

export {
  insertProcessingRequest,
  lockProcessingRequest,
  transitionProcessingRequest,
  PROCESSING_REQUEST_STATUSES,
  processingRequestStateMachine,
  type CreateProcessingRequestInput,
  type ProcessingRequestStatus,
} from './infrastructure/processing-request.repository'

export {
  submitProcessingRequest,
  approveProcessingRequest,
  rejectProcessingRequest,
  type RejectProcessingRequestInput,
} from './application/processing-request'

export {
  startJob,
  recordOutput,
  type StartJobInput,
  type RecordOutputInput,
} from './application/execute-job'

export {
  recordLoss,
  closeJob,
  type RecordLossInput,
  type CloseJobInput,
} from './application/close-job'

export {
  loadProcessingRequestSnapshot,
  type ProcessingRequestSnapshot,
} from './application/processing-request-print-snapshot'

export {
  loadJobOrderSnapshot,
  type JobOrderSnapshot,
  type JobOrderPrintInputLine,
  type JobOrderPrintExpectedOutput,
} from './application/job-order-print-snapshot'

export {
  loadYieldStatementSnapshot,
  type YieldStatementSnapshot,
  type YieldStatementOutputLine,
} from './application/yield-statement-print-snapshot'
