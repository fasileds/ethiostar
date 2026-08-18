import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { systemClock } from '@core/clock/clock'
import { toBusinessDate } from '@core/utils/date'
import { Decimal } from '@core/units/decimal'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { resolveTariffRate } from '@modules/contracts'
import { insertChargeEvent } from '../infrastructure/charge-event.repository'

export interface RaiseChargeInput {
  readonly customerId: string
  readonly branchId: string
  readonly serviceCode: string
  readonly sourceType: string
  readonly sourceId: string
  /** Weight in kg — required for PER_KG, and used as the day-count for PER_DAY/FLAT. */
  readonly quantity: string | null
  readonly keshaQuantity: number | null
  readonly occurredAt: Date
  readonly actorId: string
}

/**
 * The generic charge-raising entry point — "every billable event raised as a charge at the
 * moment the operation is recorded" (M19 spec).
 *
 * NOTE ON SCOPE: this is deliberately NOT wired into every Phase-1 operational use case
 * (goods receipt, dispatch, processing) in this pass — that would touch a lot of
 * already-working code for marginal benefit before the billing pipeline itself is proven.
 * Instead it is exposed as a manual "raise a charge" staff action
 * (`/billing/charges/new`) against a source record, so the whole pipeline — charge → invoice
 * → payment — is usable and demonstrable end-to-end. Wiring automatic charge capture into
 * each M11/M15/M17 use case is the natural next increment.
 */
export async function raiseCharge(
  claims: DbClaims,
  input: RaiseChargeInput,
): Promise<{ chargeEventId: string }> {
  return runInTransaction(claims, async (tx) => {
    const asOfDate = toBusinessDate(input.occurredAt)

    const rate = await resolveTariffRate(tx, {
      customerId: input.customerId,
      branchId: input.branchId,
      serviceCode: input.serviceCode,
      asOfDate,
    })

    if (!rate) {
      throw new BusinessRuleViolation(ERROR_CODES.VALIDATION_FAILED, {
        message: `No tariff line prices ${input.serviceCode} for this customer and branch as of ${asOfDate}.`,
      })
    }

    const rateAmount = Decimal.parse(rate.rateAmount, 2)

    let amount: Decimal
    if (rate.uom === 'PER_KG') {
      if (!input.quantity) {
        throw new BusinessRuleViolation(ERROR_CODES.VALIDATION_FAILED, {
          message: 'A quantity in kg is required for a PER_KG service.',
        })
      }
      amount = rateAmount.multiply(Decimal.parse(input.quantity, 3))
    } else if (rate.uom === 'PER_KESHA') {
      if (input.keshaQuantity === null || input.keshaQuantity === undefined) {
        throw new BusinessRuleViolation(ERROR_CODES.VALIDATION_FAILED, {
          message: 'A kesha count is required for a PER_KESHA service.',
        })
      }
      amount = rateAmount.multiplyByInteger(input.keshaQuantity)
    } else {
      // PER_DAY / FLAT — quantity doubles as the day-count, defaulting to 1 (FLAT).
      const days = input.quantity ? Decimal.parse(input.quantity, 3) : Decimal.fromInteger(1, 3)
      amount = rateAmount.multiply(days)
    }

    const chargeEventId = await insertChargeEvent(tx, {
      customerId: input.customerId,
      branchId: input.branchId,
      contractId: rate.contractId,
      serviceCode: input.serviceCode,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      quantity: input.quantity,
      keshaQuantity: input.keshaQuantity,
      uom: rate.uom,
      rateAmount: rate.rateAmount,
      amount: amount.toString(),
      currency: rate.currency,
      occurredAt: input.occurredAt,
      actorId: input.actorId,
    })

    return { chargeEventId }
  })
}

/** Convenience overload defaulting `occurredAt` to now, for the manual-entry form. */
export async function raiseChargeNow(
  claims: DbClaims,
  input: Omit<RaiseChargeInput, 'occurredAt'>,
): Promise<{ chargeEventId: string }> {
  return raiseCharge(claims, { ...input, occurredAt: systemClock.now() })
}
