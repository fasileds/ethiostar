import 'server-only'
import type { DocumentSeriesCode } from '@config/constants'
import {
  loadReleaseRequestSnapshot,
  loadLoadingListSnapshot,
  loadDispatchNoteSnapshot,
  loadGatePassSnapshot,
} from '@modules/dispatch'
import { ReleaseRequestDocument } from '@platform/pdf/templates/release-request'
import { LoadingListDocument } from '@platform/pdf/templates/loading-list'
import { DispatchNoteDocument } from '@platform/pdf/templates/dispatch-note'
import { GatePassDocument } from '@platform/pdf/templates/gate-pass'
import type { DocumentRegistryEntry } from '../types'

/** M17 outbound dispatch documents: release request, loading list, dispatch note, gate pass. */
export const DISPATCH_ENTRIES: Partial<Record<DocumentSeriesCode, DocumentRegistryEntry>> = {
  RR: {
    sourceType: 'release_request',
    load: async (tx, sourceId) => {
      const snapshot = await loadReleaseRequestSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <ReleaseRequestDocument
            organisationName={common.organisationName}
            branchName={snapshot.branchName}
            documentNumber={snapshot.reference}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            customerName={snapshot.customerName}
            consignmentReference={snapshot.consignmentReference}
            status={snapshot.status}
            requestedQuantityKg={snapshot.requestedQuantityKg}
            requestedKeshaCount={snapshot.requestedKeshaCount}
            requestedCollectionOn={snapshot.requestedCollectionOn}
            authorisedByName={snapshot.authorisedByName}
            collectorName={snapshot.collectorName}
            collectorIdNo={snapshot.collectorIdNo}
            collectorPhone={snapshot.collectorPhone}
            vehiclePlate={snapshot.vehiclePlate}
            submittedAt={snapshot.submittedAt}
            approvedByName={snapshot.approvedByName}
            approvedAt={snapshot.approvedAt}
            notes={snapshot.notes}
          />
        ),
      }
    },
  },

  LL: {
    sourceType: 'loading_list',
    load: async (tx, sourceId) => {
      const snapshot = await loadLoadingListSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <LoadingListDocument
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
            vehiclePlate={snapshot.vehiclePlate}
            trailerPlate={snapshot.trailerPlate}
            driverName={snapshot.driverName}
            transporterName={snapshot.transporterName}
            destination={snapshot.destination}
            plannedQuantityKg={snapshot.plannedQuantityKg}
            plannedKeshaCount={snapshot.plannedKeshaCount}
            loadingStartedAt={snapshot.loadingStartedAt}
            notes={snapshot.notes}
            lines={snapshot.lines}
          />
        ),
      }
    },
  },

  DN: {
    sourceType: 'dispatch_note',
    load: async (tx, sourceId) => {
      const snapshot = await loadDispatchNoteSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <DispatchNoteDocument
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
            vehiclePlate={snapshot.vehiclePlate}
            trailerPlate={snapshot.trailerPlate}
            driverName={snapshot.driverName}
            transporterName={snapshot.transporterName}
            destination={snapshot.destination}
            loadedQuantityKg={snapshot.loadedQuantityKg}
            loadedKeshaCount={snapshot.loadedKeshaCount}
            plannedQuantityKg={snapshot.plannedQuantityKg}
            plannedKeshaCount={snapshot.plannedKeshaCount}
            gateOutAt={snapshot.gateOutAt}
            dispatchedAt={snapshot.dispatchedAt}
            notes={snapshot.notes}
            lines={snapshot.lines}
          />
        ),
      }
    },
  },

  GP: {
    sourceType: 'gate_pass',
    load: async (tx, sourceId) => {
      const snapshot = await loadGatePassSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <GatePassDocument
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
            vehiclePlate={snapshot.vehiclePlate}
            trailerPlate={snapshot.trailerPlate}
            driverName={snapshot.driverName}
            driverIdNo={snapshot.driverIdNo}
            driverPhone={snapshot.driverPhone}
            transporterName={snapshot.transporterName}
            destination={snapshot.destination}
            loadedQuantityKg={snapshot.loadedQuantityKg}
            loadedKeshaCount={snapshot.loadedKeshaCount}
            clearanceStatus={snapshot.clearanceStatus}
            clearanceNote={snapshot.clearanceNote}
            clearanceCheckedAt={snapshot.clearanceCheckedAt}
            clearanceCheckedByName={snapshot.clearanceCheckedByName}
            gateOutAt={snapshot.gateOutAt}
          />
        ),
      }
    },
  },
}
