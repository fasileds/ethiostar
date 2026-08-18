import 'server-only'
import type { DocumentSeriesCode } from '@config/constants'
import {
  loadProcessingRequestSnapshot,
  loadJobOrderSnapshot,
  loadYieldStatementSnapshot,
} from '@modules/processing'
import { loadMirtMerekebiyaSnapshot } from '@modules/acceptance'
import { loadAppointmentPrintSnapshot } from '@modules/scheduling'
import { ProcessingRequestDocument } from '@platform/pdf/templates/processing-request'
import { JobOrderDocument } from '@platform/pdf/templates/job-order'
import { YieldStatementDocument } from '@platform/pdf/templates/yield-statement'
import { MirtMerekebiyaDocument } from '@platform/pdf/templates/mirt-merekebiya'
import { AppointmentDocument } from '@platform/pdf/templates/appointment'
import type { DocumentRegistryEntry } from '../types'

/** M14/M15/M16 scheduling and processing documents. */
export const PROCESSING_ENTRIES: Partial<Record<DocumentSeriesCode, DocumentRegistryEntry>> = {
  PR: {
    sourceType: 'processing_request',
    load: async (tx, sourceId) => {
      const snapshot = await loadProcessingRequestSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <ProcessingRequestDocument
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
            serviceType={snapshot.serviceType}
            requestedQuantityKg={snapshot.requestedQuantityKg}
            requestedKeshaCount={snapshot.requestedKeshaCount}
            outputSpecification={snapshot.outputSpecification}
            preferredStartOn={snapshot.preferredStartOn}
            urgency={snapshot.urgency}
            submittedAt={snapshot.submittedAt}
            approvedByName={snapshot.approvedByName}
            approvedAt={snapshot.approvedAt}
            notes={snapshot.notes}
          />
        ),
      }
    },
  },

  JOB: {
    sourceType: 'job_order',
    load: async (tx, sourceId) => {
      const snapshot = await loadJobOrderSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <JobOrderDocument
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
            processingRequestReference={snapshot.processingRequestReference}
            status={snapshot.status}
            serviceType={snapshot.serviceType}
            machineName={snapshot.machineName}
            plannedInputKg={snapshot.plannedInputKg}
            plannedKeshaCount={snapshot.plannedKeshaCount}
            scheduledStartAt={snapshot.scheduledStartAt}
            supervisorName={snapshot.supervisorName}
            notes={snapshot.notes}
            inputs={snapshot.inputs}
            expectedOutputs={snapshot.expectedOutputs}
          />
        ),
      }
    },
  },

  YLD: {
    sourceType: 'job_order_yield',
    load: async (tx, sourceId) => {
      const snapshot = await loadYieldStatementSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <YieldStatementDocument
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
            serviceType={snapshot.serviceType}
            closedAt={snapshot.closedAt}
            actualInputKg={snapshot.actualInputKg}
            actualOutputKg={snapshot.actualOutputKg}
            actualLossKg={snapshot.actualLossKg}
            yieldPct={snapshot.yieldPct}
            lossPct={snapshot.lossPct}
            varianceKg={snapshot.varianceKg}
            toleranceAppliedPct={snapshot.toleranceAppliedPct}
            massBalanceStatus={snapshot.massBalanceStatus}
            withinTolerance={snapshot.withinTolerance}
            varianceReason={snapshot.varianceReason}
            varianceApprovedByName={snapshot.varianceApprovedByName}
            outputs={snapshot.outputs}
          />
        ),
      }
    },
  },

  MIRT: {
    sourceType: 'acceptance_record',
    load: async (tx, sourceId) => {
      const snapshot = await loadMirtMerekebiyaSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <MirtMerekebiyaDocument
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
            jobOrderReference={snapshot.jobOrderReference}
            status={snapshot.status}
            presentedQuantityKg={snapshot.presentedQuantityKg}
            presentedKeshaCount={snapshot.presentedKeshaCount}
            acceptedQuantityKg={snapshot.acceptedQuantityKg}
            acceptedKeshaCount={snapshot.acceptedKeshaCount}
            disputedQuantityKg={snapshot.disputedQuantityKg}
            yieldPct={snapshot.yieldPct}
            lossPct={snapshot.lossPct}
            presentedAt={snapshot.presentedAt}
            customerRepName={snapshot.customerRepName}
            customerRepIdNo={snapshot.customerRepIdNo}
            signedAt={snapshot.signedAt}
            witnessName={snapshot.witnessName}
            notes={snapshot.notes}
            lines={snapshot.lines}
          />
        ),
      }
    },
  },

  APT: {
    sourceType: 'appointment',
    load: async (tx, sourceId) => {
      const snapshot = await loadAppointmentPrintSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <AppointmentDocument
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
            machineName={snapshot.machineName}
            machineCode={snapshot.machineCode}
            scheduledOn={snapshot.scheduledOn}
            scheduledStartAt={snapshot.scheduledStartAt}
            scheduledEndAt={snapshot.scheduledEndAt}
            plannedQuantityKg={snapshot.plannedQuantityKg}
            plannedKeshaCount={snapshot.plannedKeshaCount}
            status={snapshot.status}
            rescheduleReason={snapshot.rescheduleReason}
            rescheduledFromAt={snapshot.rescheduledFromAt}
            cumulativeDelayMinutes={snapshot.cumulativeDelayMinutes}
            notes={snapshot.notes}
          />
        ),
      }
    },
  },
}
