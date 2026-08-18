import 'server-only'
import type { DocumentSeriesCode } from '@config/constants'
import { loadGoodsReceiptSnapshot, loadDeliveryRequestSnapshot } from '@modules/inbound'
import { loadStorePlacementSnapshot } from '@modules/consignment'
import { GoodsReceiptDocument } from '@platform/pdf/templates/goods-receipt'
import { DeliveryRequestDocument } from '@platform/pdf/templates/delivery-request'
import { StorePlacementDocument } from '@platform/pdf/templates/store-placement'
import type { DocumentRegistryEntry } from '../types'

/** M11/M12 receiving and storage documents: GRN, delivery request, store placement. */
export const RECEIVING_AND_STORAGE_ENTRIES: Partial<
  Record<DocumentSeriesCode, DocumentRegistryEntry>
> = {
  GRN: {
    sourceType: 'goods_receipt',
    load: async (tx, sourceId) => {
      const snapshot = await loadGoodsReceiptSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <GoodsReceiptDocument
            organisationName={common.organisationName}
            branchName={snapshot.branchName}
            documentNumber={snapshot.reference}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            customerName={snapshot.customerName}
            vehiclePlate={snapshot.vehiclePlate}
            driverName={snapshot.driverName}
            customerRepName={snapshot.customerRepName}
            locationLabel={snapshot.locationLabel}
            occurredAt={snapshot.occurredAt}
            receivedByName={snapshot.receivedByName}
            notes={snapshot.notes}
            receivedQuantityKg={snapshot.receivedQuantityKg}
            receivedKeshaCount={snapshot.receivedKeshaCount}
            varianceKg={snapshot.varianceKg}
            variancePct={snapshot.variancePct}
            lines={snapshot.lines}
          />
        ),
      }
    },
  },

  DR: {
    sourceType: 'delivery_request',
    load: async (tx, sourceId) => {
      const snapshot = await loadDeliveryRequestSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <DeliveryRequestDocument
            organisationName={common.organisationName}
            branchName={snapshot.branchName}
            documentNumber={snapshot.reference}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            customerName={snapshot.customerName}
            status={snapshot.status}
            coffeeTypeName={snapshot.coffeeTypeName}
            coffeeGradeName={snapshot.coffeeGradeName}
            declaredQuantityKg={snapshot.declaredQuantityKg}
            declaredKeshaCount={snapshot.declaredKeshaCount}
            expectedArrivalOn={snapshot.expectedArrivalOn}
            expectedArrivalWindow={snapshot.expectedArrivalWindow}
            transportMode={snapshot.transportMode}
            vehiclePlate={snapshot.vehiclePlate}
            driverName={snapshot.driverName}
            driverPhone={snapshot.driverPhone}
            approvedByName={snapshot.approvedByName}
            approvedAt={snapshot.approvedAt}
            rejectionReason={snapshot.rejectionReason}
            notes={snapshot.notes}
          />
        ),
      }
    },
  },

  SP: {
    sourceType: 'lot_placement',
    load: async (tx, sourceId) => {
      const snapshot = await loadStorePlacementSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.lotReference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <StorePlacementDocument
            organisationName={common.organisationName}
            documentNumber={snapshot.lotReference}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            customerName={snapshot.customerName}
            consignmentReference={snapshot.consignmentReference}
            coffeeTypeName={snapshot.coffeeTypeName}
            coffeeGradeName={snapshot.coffeeGradeName}
            bagTypeName={snapshot.bagTypeName}
            quantityKg={snapshot.quantityKg}
            keshaCount={snapshot.keshaCount}
            locationLabel={snapshot.locationLabel}
            placedAt={snapshot.placedAt}
            placedByName={snapshot.placedByName}
          />
        ),
      }
    },
  },
}
