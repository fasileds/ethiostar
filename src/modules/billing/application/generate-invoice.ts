import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { systemClock } from '@core/clock/clock'
import { toBusinessDate, addBusinessDays } from '@core/utils/date'
import { Decimal } from '@core/units/decimal'
import { BusinessRuleViolation, NotFoundError } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { findActiveContractAsOf } from '@modules/contracts'
import {
  listUninvoicedChargeEvents,
  markChargeEventInvoiced,
} from '../infrastructure/charge-event.repository'
import {
  createInvoiceDraft,
  insertInvoiceLine,
  lockInvoice,
  setInvoiceStatus,
  voidInvoiceRow,
} from '../infrastructure/invoice.repository'

const DEFAULT_PAYMENT_TERMS_DAYS = 30

export interface GenerateInvoiceInput {
  readonly customerId: string
  readonly branchId: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly actorId: string
}

/**
 * Sweep every un-invoiced charge event for the customer in the period into a new DRAFT
 * invoice — one line PER CHARGE EVENT (not grouped by service code), so
 * `invoice_line.charge_event_id` stays a one-to-one trace from a printed invoice line back to
 * the exact goods receipt, job order or storage span that caused it, per the module's own
 * design comment. Grouping would read cleaner on the page but lose that traceability, which
 * this system treats as the more important property.
 */
export async function generateInvoice(
  claims: DbClaims,
  input: GenerateInvoiceInput,
): Promise<{ invoiceId: string; reference: string }> {
  return runInTransaction(claims, async (tx) => {
    const charges = await listUninvoicedChargeEvents(
      tx,
      input.customerId,
      input.periodStart,
      input.periodEnd,
    )

    if (charges.length === 0) {
      throw new BusinessRuleViolation(ERROR_CODES.VALIDATION_FAILED, {
        message: 'There are no uninvoiced charges for this customer in the selected period.',
      })
    }

    const currency = charges[0]?.currency ?? 'ETB'
    const subtotal = Decimal.sum(
      charges.map((c) => Decimal.parse(c.amount, 2)),
      2,
    )

    const now = systemClock.now()
    const issueDate = toBusinessDate(now)
    const contract = await findActiveContractAsOf(
      tx,
      input.customerId,
      input.branchId,
      issueDate,
    )
    const termsDays = contract?.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS
    const dueDate = addBusinessDays(issueDate, termsDays)

    const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.TAX_INVOICE, {
      branchId: input.branchId,
      actorId: input.actorId,
    })

    const invoiceId = await createInvoiceDraft(tx, {
      reference: allocated.formatted,
      customerId: input.customerId,
      branchId: input.branchId,
      contractId: contract?.id ?? null,
      issueDate,
      dueDate,
      subtotalAmount: subtotal.toString(),
      currency,
      actorId: input.actorId,
    })

    for (const [index, charge] of charges.entries()) {
      const lineId = await insertInvoiceLine(tx, {
        invoiceId,
        chargeEventId: charge.id,
        lineNo: index + 1,
        description: `${charge.serviceCode} — ${charge.sourceType} ${charge.sourceId.slice(0, 8)}`,
        serviceCode: charge.serviceCode,
        quantity: charge.quantity,
        uom: charge.uom,
        rateAmount: charge.rateAmount,
        lineAmount: charge.amount,
        actorId: input.actorId,
      })
      await markChargeEventInvoiced(tx, charge.id, lineId)
    }

    return { invoiceId, reference: allocated.formatted }
  })
}

export async function issueInvoice(
  claims: DbClaims,
  invoiceId: string,
  actorId: string,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId)
    if (!invoice) throw NotFoundError.of('Invoice', invoiceId)
    if (invoice.status !== 'DRAFT') {
      throw new BusinessRuleViolation(ERROR_CODES.INVALID_STATE_TRANSITION, {
        message: `Invoice ${invoice.reference} is not a draft.`,
      })
    }
    await setInvoiceStatus(tx, invoiceId, 'ISSUED', actorId)
  })
}

export async function voidInvoice(
  claims: DbClaims,
  invoiceId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId)
    if (!invoice) throw NotFoundError.of('Invoice', invoiceId)
    if (invoice.status !== 'DRAFT' && invoice.status !== 'ISSUED') {
      throw new BusinessRuleViolation(ERROR_CODES.INVALID_STATE_TRANSITION, {
        message: `Invoice ${invoice.reference} can no longer be voided.`,
      })
    }
    await voidInvoiceRow(tx, invoiceId, reason, actorId)
  })
}
