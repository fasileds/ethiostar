/**
 * M11 — Inbound Coffee Reception.
 *
 * The goods receipt is what creates stock. Everything before it is an expectation.
 */

export {
  listDeliveryRequests,
  deliveryRequestStatusCounts,
  findDeliveryRequest,
  sectionsWithRoom,
  expectedArrivals,
  listGoodsReceipts,
  type DeliveryRequestRow,
  type DeliveryRequestDetail,
  type DeliveryRequestFilters,
  type AvailableSection,
  type ExpectedArrival,
  type GoodsReceiptRow,
} from './application/delivery-request.query'

export {
  DELIVERY_REQUEST_STATUSES,
  DELIVERY_REQUEST_TRANSITIONS,
  deliveryRequestStateMachine,
  type DeliveryRequestStatus,
} from './domain/delivery-request-status'

export { submitDeliveryRequest } from './application/submit-delivery-request'

export {
  approveDeliveryRequest,
  rejectDeliveryRequest,
  type ApproveDeliveryRequestInput,
  type RejectDeliveryRequestInput,
} from './application/approve-delivery-request'

export {
  createGoodsReceipt,
  type CreateGoodsReceiptInput,
  type GoodsReceiptResult,
} from './application/create-goods-receipt'

export type { CreateDeliveryRequestInput } from './infrastructure/delivery-request.repository'
export type { GoodsReceiptLineInput } from './infrastructure/goods-receipt.repository'

export {
  deliveryRequestFormOptions,
  type DeliveryRequestFormOptions,
  type FormOption,
} from './application/delivery-request-form-options.query'

export {
  loadGoodsReceiptSnapshot,
  type GoodsReceiptSnapshot,
  type GoodsReceiptPrintLine,
} from './application/goods-receipt-print-snapshot'

export {
  loadDeliveryRequestSnapshot,
  type DeliveryRequestSnapshot,
} from './application/delivery-request-print-snapshot'
