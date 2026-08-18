import 'server-only'
import type { DocumentSeriesCode } from '@config/constants'
import {
  loadStoreTransferSnapshot,
  loadStockAdjustmentSnapshot,
  loadStockCountSnapshot,
} from '@modules/stock'
import { StoreTransferDocument } from '@platform/pdf/templates/store-transfer'
import { StockAdjustmentDocument } from '@platform/pdf/templates/stock-adjustment'
import { StockCountDocument } from '@platform/pdf/templates/stock-count'
import type { DocumentRegistryEntry } from '../types'

/** Stock ledger documents: store transfer, stock adjustment, stock count. */
export const STOCK_ENTRIES: Partial<Record<DocumentSeriesCode, DocumentRegistryEntry>> = {
  ST: {
    sourceType: 'stock_transfer',
    load: async (tx, sourceId) => {
      const snapshot = await loadStoreTransferSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <StoreTransferDocument
            organisationName={common.organisationName}
            branchName={snapshot.branchName}
            documentNumber={snapshot.reference}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            customerName={snapshot.customerName}
            lotReference={snapshot.lotReference}
            coffeeType={snapshot.coffeeType}
            coffeeGrade={snapshot.coffeeGrade}
            bagType={snapshot.bagType}
            quantityKg={snapshot.quantityKg}
            keshaCount={snapshot.keshaCount}
            fromLocationLabel={snapshot.fromLocationLabel}
            toLocationLabel={snapshot.toLocationLabel}
            reasonName={snapshot.reasonName}
            narrative={snapshot.narrative}
            occurredAt={snapshot.occurredAt}
            authorisedByName={snapshot.authorisedByName}
          />
        ),
      }
    },
  },

  ADJ: {
    sourceType: 'stock_adjustment',
    load: async (tx, sourceId) => {
      const snapshot = await loadStockAdjustmentSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <StockAdjustmentDocument
            organisationName={common.organisationName}
            branchName={snapshot.branchName}
            documentNumber={snapshot.reference}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            customerName={snapshot.customerName}
            lotReference={snapshot.lotReference}
            coffeeType={snapshot.coffeeType}
            coffeeGrade={snapshot.coffeeGrade}
            bagType={snapshot.bagType}
            locationLabel={snapshot.locationLabel}
            quantityKgDelta={snapshot.quantityKgDelta}
            keshaCountDelta={snapshot.keshaCountDelta}
            beforeQuantityKg={snapshot.beforeQuantityKg}
            beforeKeshaCount={snapshot.beforeKeshaCount}
            afterQuantityKg={snapshot.afterQuantityKg}
            afterKeshaCount={snapshot.afterKeshaCount}
            reasonName={snapshot.reasonName}
            narrative={snapshot.narrative}
            occurredAt={snapshot.occurredAt}
            createdByName={snapshot.createdByName}
            approvedByName={snapshot.approvedByName}
            approvedAt={snapshot.approvedAt}
          />
        ),
      }
    },
  },

  CNT: {
    sourceType: 'stock_count',
    load: async (tx, sourceId) => {
      const snapshot = await loadStockCountSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: null,
        snapshot,
        element: (common) => (
          <StockCountDocument
            organisationName={common.organisationName}
            branchName={snapshot.branchName}
            documentNumber={snapshot.reference}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            locationLabel={snapshot.locationLabel}
            countedOn={snapshot.countedOn}
            status={snapshot.status}
            countedByName={snapshot.countedByName}
            approvedByName={snapshot.approvedByName}
            approvedAt={snapshot.approvedAt}
            lines={snapshot.lines}
          />
        ),
      }
    },
  },
}
