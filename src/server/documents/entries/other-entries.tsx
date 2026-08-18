import 'server-only'
import type { DocumentSeriesCode } from '@config/constants'
import { loadLabourVoucherSnapshot } from '@modules/labour'
import { loadApplicationAcknowledgementSnapshot } from '@modules/onboarding'
import { loadCustomerRegistrationSnapshot } from '@modules/customers'
import { LabourVoucherDocument } from '@platform/pdf/templates/labour-voucher'
import { ApplicationAcknowledgementDocument } from '@platform/pdf/templates/application-acknowledgement'
import { RegistrationCertificateDocument } from '@platform/pdf/templates/registration-certificate'
import type { DocumentRegistryEntry } from '../types'

/** M18 labour and onboarding documents: labour voucher, application acknowledgement, registration certificate. */
export const OTHER_ENTRIES: Partial<Record<DocumentSeriesCode, DocumentRegistryEntry>> = {
  LV: {
    sourceType: 'labour_output',
    load: async (tx, sourceId) => {
      const snapshot = await loadLabourVoucherSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.jobOrderReference ?? snapshot.anchorOutputId,
        customerId: null,
        snapshot,
        element: (common) => (
          <LabourVoucherDocument
            organisationName={common.organisationName}
            documentNumber={snapshot.jobOrderReference ?? snapshot.anchorOutputId}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            crewName={snapshot.crewName}
            jobOrderReference={snapshot.jobOrderReference}
            consignmentReference={snapshot.consignmentReference}
            activityTypeName={snapshot.activityTypeName}
            producedOn={snapshot.producedOn}
            rateBasis={snapshot.rateBasis}
            rateAmount={snapshot.rateAmount}
            currency={snapshot.currency}
            confirmedKeshaCount={snapshot.confirmedKeshaCount}
            totalQuantityKg={snapshot.totalQuantityKg}
            totalAmount={snapshot.totalAmount}
            workers={snapshot.workers}
          />
        ),
      }
    },
  },

  APP: {
    sourceType: 'customer_application',
    load: async (tx, sourceId) => {
      const snapshot = await loadApplicationAcknowledgementSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.reference,
        customerId: null,
        snapshot,
        element: (common) => (
          <ApplicationAcknowledgementDocument
            organisationName={common.organisationName}
            branchName={snapshot.branchName}
            documentNumber={snapshot.reference}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            reference={snapshot.reference}
            legalName={snapshot.legalName}
            businessTypeName={snapshot.businessTypeName}
            contactName={snapshot.contactName}
            contactEmail={snapshot.contactEmail}
            submittedAt={snapshot.submittedAt}
            attachedDocuments={snapshot.attachedDocuments}
          />
        ),
      }
    },
  },

  CUS: {
    sourceType: 'customer',
    load: async (tx, sourceId) => {
      const snapshot = await loadCustomerRegistrationSnapshot(tx, sourceId)
      if (!snapshot) return undefined

      return {
        documentReference: snapshot.code,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <RegistrationCertificateDocument
            organisationName={common.organisationName}
            branchName={snapshot.branchName}
            documentNumber={snapshot.code}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            legalName={snapshot.legalName}
            code={snapshot.code}
            businessTypeName={snapshot.businessTypeName}
            onboardedOn={snapshot.onboardedOn}
            primaryContactEmail={snapshot.primaryContactEmail}
            credentialsIssued={snapshot.credentialsIssued}
          />
        ),
      }
    },
  },
}
