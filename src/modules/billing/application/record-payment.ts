import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { Decimal } from '@core/units/decimal'
import { BusinessRuleViolation, NotFoundError } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { insertPayment } from '../infrastructure/payment.repository'
import { lockInvoice, addPaidAmount } from '../infrastructure/invoice.repository'
import { checkAndApplyCreditHold } from './credit-control'

export interface RecordPaymentInput {
  readonly customerId: string
  readonly invoiceId: string | null
  readonly amount: string
  readonly currency: string
  readonly method: string
  readonly externalReference: string | null
  readonly receivedAt: Date
  readonly actorId: string
}

/**
 * Record a payment and, if it is against a specific invoice, roll it into that invoice's
 * `paidAmount` and flip status: PARTIALLY_PAID while short, PAID once covered. A payment with
 * no `invoiceId` sits on account, unallocated — future allocation is out of scope here.
 */
export async function recordPayment(
  claims: DbClaims,
  input: RecordPaymentInput,
): Promise<{ paymentId: string }> {
  return runInTransaction(claims, async (tx) => {
    const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.RECEIPT, {
      branchId: null,
      actorId: input.actorId,
    })

    const paymentId = await insertPayment(tx, {
      reference: allocated.formatted,
      customerId: input.customerId,
      invoiceId: input.invoiceId,
      amount: input.amount,
      currency: input.currency,
      method: input.method,
      externalReference: input.externalReference,
      receivedAt: input.receivedAt,
      recordedBy: input.actorId,
    })

    if (input.invoiceId) {
      const invoice = await lockInvoice(tx, input.invoiceId)
      if (!invoice) throw NotFoundError.of('Invoice', input.invoiceId)
      if (invoice.status === 'VOID' || invoice.status === 'DRAFT') {
        throw new BusinessRuleViolation(ERROR_CODES.INVALID_STATE_TRANSITION, {
          message: `Invoice ${invoice.reference} cannot receive a payment in status ${invoice.status}.`,
        })
      }

      const newPaid = Decimal.parse(invoice.paidAmount, 2).add(Decimal.parse(input.amount, 2))
      const total = Decimal.parse(invoice.totalAmount, 2)
      const newStatus = newPaid.greaterThanOrEqual(total) ? 'PAID' : 'PARTIALLY_PAID'

      await addPaidAmount(tx, input.invoiceId, input.amount, newStatus, input.actorId)
    }

    // Re-check in case OTHER invoices still leave the customer over terms — this never
    // releases an existing hold (that is a manual `releaseCreditHold` decision), only
    // applies a new one if warranted.
    await checkAndApplyCreditHold(tx, input.customerId)

    return { paymentId }
  })
}
