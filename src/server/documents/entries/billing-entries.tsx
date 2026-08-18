import 'server-only'
import type { DocumentSeriesCode } from '@config/constants'
import { systemClock } from '@core/clock/clock'
import {
  addBusinessDays,
  toBusinessDate,
  startOfBusinessDay,
  endOfBusinessDay,
} from '@core/utils/date'
import {
  loadInvoiceSnapshot,
  loadReceiptSnapshot,
  loadAccountStatementSnapshot,
} from '@modules/billing'
import { InvoiceDocument } from '@platform/pdf/templates/invoice'
import { ReceiptDocument } from '@platform/pdf/templates/receipt'
import { AccountStatementDocument } from '@platform/pdf/templates/account-statement'
import type { DocumentRegistryEntry } from '../types'

/** M19 billing documents: tax invoice, proforma invoice, receipt, account statement. */
export const BILLING_ENTRIES: Partial<Record<DocumentSeriesCode, DocumentRegistryEntry>> = {
  INV: {
    sourceType: 'invoice',
    load: async (tx, sourceId) => {
      const snapshot = await loadInvoiceSnapshot(tx, sourceId)
      if (!snapshot) return undefined
      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <InvoiceDocument
            organisationName={common.organisationName}
            branchName={snapshot.branchName}
            documentNumber={snapshot.reference}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            isProforma={false}
            customerName={snapshot.customerName}
            status={snapshot.status}
            issueDate={snapshot.issueDate}
            dueDate={snapshot.dueDate}
            subtotalAmount={snapshot.subtotalAmount}
            taxAmount={snapshot.taxAmount}
            totalAmount={snapshot.totalAmount}
            paidAmount={snapshot.paidAmount}
            currency={snapshot.currency}
            notes={snapshot.notes}
            lines={snapshot.lines}
          />
        ),
      }
    },
  },

  PFI: {
    sourceType: 'invoice',
    load: async (tx, sourceId) => {
      const snapshot = await loadInvoiceSnapshot(tx, sourceId)
      if (!snapshot) return undefined
      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <InvoiceDocument
            organisationName={common.organisationName}
            branchName={snapshot.branchName}
            documentNumber={snapshot.reference}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            isProforma={true}
            customerName={snapshot.customerName}
            status={snapshot.status}
            issueDate={snapshot.issueDate}
            dueDate={snapshot.dueDate}
            subtotalAmount={snapshot.subtotalAmount}
            taxAmount={snapshot.taxAmount}
            totalAmount={snapshot.totalAmount}
            paidAmount={snapshot.paidAmount}
            currency={snapshot.currency}
            notes={snapshot.notes}
            lines={snapshot.lines}
          />
        ),
      }
    },
  },

  RCT: {
    sourceType: 'payment',
    load: async (tx, sourceId) => {
      const snapshot = await loadReceiptSnapshot(tx, sourceId)
      if (!snapshot) return undefined
      return {
        documentReference: snapshot.reference,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <ReceiptDocument
            organisationName={common.organisationName}
            documentNumber={snapshot.reference}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            customerName={snapshot.customerName}
            invoiceReference={snapshot.invoiceReference}
            amount={snapshot.amount}
            currency={snapshot.currency}
            method={snapshot.method}
            externalReference={snapshot.externalReference}
            receivedAt={snapshot.receivedAt}
            recordedByName={snapshot.recordedByName}
          />
        ),
      }
    },
  },

  // No single source record — `sourceId` is the customer id, and the period is the trailing
  // 90 days ending today. A dedicated staff/portal action can call `loadAccountStatementSnapshot`
  // directly with an explicit period; this registry entry is the "print it now" shortcut.
  STM: {
    sourceType: 'customer_statement',
    load: async (tx, sourceId) => {
      const today = toBusinessDate(systemClock.now())
      const periodEnd = endOfBusinessDay(today)
      const periodStart = startOfBusinessDay(addBusinessDays(today, -90))
      const snapshot = await loadAccountStatementSnapshot(tx, sourceId, periodStart, periodEnd)
      if (!snapshot) return undefined
      return {
        documentReference: null,
        customerId: snapshot.customerId,
        snapshot,
        element: (common) => (
          <AccountStatementDocument
            organisationName={common.organisationName}
            documentNumber={`STM-${snapshot.customerId.slice(0, 8)}`}
            qrDataUri={common.qrDataUri}
            locale={common.locale}
            copyNo={common.copyNo}
            printedAt={common.printedAt}
            printedByName={common.printedByName}
            customerName={snapshot.customerName}
            periodStart={snapshot.periodStart}
            periodEnd={snapshot.periodEnd}
            currency={snapshot.currency}
            openingBalance={snapshot.openingBalance}
            closingBalance={snapshot.closingBalance}
            invoices={snapshot.invoices}
            payments={snapshot.payments}
          />
        ),
      }
    },
  },
}
