import 'server-only'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { systemClock } from '@core/clock/clock'
import { toBusinessDate } from '@core/utils/date'
import { Decimal } from '@core/units/decimal'
import type { HoldReason } from '@modules/dispatch'
import { findActiveContractAsOf } from '@modules/contracts'
import { findCustomer } from '@modules/customers'
import { outstandingBalanceFor, hasOverdueInvoice } from '../infrastructure/invoice.repository'
import { findOpenHold, insertHold, releaseHold } from '../infrastructure/credit-hold.repository'

/**
 * The M19 financial hold — `HoldReason`'s second implementation, alongside M17's document
 * hold. Idempotent: does nothing if a hold is already open for the customer, so calling this
 * after every payment and every invoice generation is safe and cheap.
 */
export async function checkAndApplyCreditHold(tx: Tx, customerId: string): Promise<void> {
  const existing = await findOpenHold(tx, customerId)
  if (existing) return

  const now = systemClock.now()
  const overdue = await hasOverdueInvoice(tx, customerId, now)

  const balance = await outstandingBalanceFor(tx, customerId)
  const customer = await findCustomer(tx, customerId)
  const contract = customer
    ? await findActiveContractAsOf(tx, customerId, customer.branchId, toBusinessDate(now))
    : null
  const creditLimit = contract?.creditLimitAmount
    ? Decimal.parse(contract.creditLimitAmount, 2)
    : null
  const overLimit = creditLimit ? Decimal.parse(balance, 2).greaterThan(creditLimit) : false

  if (!overdue && !overLimit) return

  await insertHold(tx, {
    customerId,
    reason: overdue ? 'OVERDUE_BALANCE' : 'CREDIT_LIMIT_EXCEEDED',
    note: overdue
      ? 'An invoice passed its due date while still owing.'
      : `Outstanding balance ${balance} exceeds the contract credit limit ${creditLimit?.toString()}.`,
    isAutomatic: true,
    heldBy: null,
  })
}

export interface ReleaseCreditHoldInput {
  readonly holdId: string
  readonly actorId: string
}

export async function releaseCreditHold(
  claims: DbClaims,
  input: ReleaseCreditHoldInput,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    await releaseHold(tx, input.holdId, input.actorId)
  })
}

/** What M14/M17 call to fold the financial hold into their own clearance checks. */
export async function financialHoldsFor(tx: Tx, customerId: string): Promise<HoldReason[]> {
  const hold = await findOpenHold(tx, customerId)
  if (!hold) return []

  return [
    {
      code: hold.reason,
      message:
        hold.reason === 'OVERDUE_BALANCE'
          ? 'This customer has an overdue balance on account.'
          : hold.reason === 'CREDIT_LIMIT_EXCEEDED'
            ? 'This customer is over their contract credit limit.'
            : (hold.note ?? 'This customer account is on a manual financial hold.'),
      overridableBy: 'billing:override_hold',
    },
  ]
}
