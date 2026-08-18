/**
 * The stock ledger.
 *
 * Append-only movements are the source of truth; `stock_balance` is a projection that can
 * be rebuilt from them. The reverse is impossible, and that asymmetry is the whole argument.
 * docs/adr/0003-consignment-spine-and-stock-ledger.md
 */

export {
  validateMovement,
  assertTransferBalances,
  jobBalance,
  buildTransfer,
  balanceOf,
  assertSufficientStock,
  MOVEMENT_TYPES,
  MOVEMENT_SIGN,
  REASON_REQUIRED_TYPES,
  type StockMovement,
  type MovementType,
} from './domain/movement'

export {
  listStockOnHand,
  listMovements,
  stockByCustomer,
  reconciliationVariances,
  type StockOnHandRow,
  type MovementRow,
  type CustomerStockSummary,
  type ReconciliationVariance,
} from './application/stock.query'

export { postMovements } from './infrastructure/stock.repository'

export { transferStock, type TransferStockInput } from './application/transfer-stock'

export { adjustStock, type AdjustStockInput } from './application/adjust-stock'

export {
  startStockCount,
  recordCountedLine,
  approveStockCount,
  cancelStockCount,
} from './application/physical-count'

export {
  loadStoreTransferSnapshot,
  type StoreTransferSnapshot,
} from './application/store-transfer-print-snapshot'

export {
  loadStockAdjustmentSnapshot,
  type StockAdjustmentSnapshot,
} from './application/stock-adjustment-print-snapshot'

export {
  loadStockCountSnapshot,
  type StockCountSnapshot,
  type StockCountPrintLine,
} from './application/stock-count-print-snapshot'
