import { Money } from '@core/units/money'
import { KeshaCount } from '@core/units/kesha'
import { Decimal } from '@core/units/decimal'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

/**
 * M18 — piece-rate calculation.
 *
 * THE KEY CONTROL, verbatim: "Labour payment is always calculated from the store keeper's
 * confirmed kesha count — there is no independent quantity entry for payroll purposes."
 *
 * That control is structural, not a rule anybody has to remember:
 *   • `LabourActivity.keshaCount` is written ONLY by a domain-event handler.
 *   • There is no UI input control for it, anywhere.
 *   • The calculation below takes the count as a parameter it cannot invent.
 *
 * "removing the parallel tally sheet that is the usual source of both overpayment and
 * dispute."
 */

export type SplitMethod = 'EQUAL' | 'BY_INDIVIDUAL_COUNT'

export interface PieceRateVersion {
  readonly id: string
  readonly amountPerKesha: Money
  readonly overtimeMultiplier: Decimal
  readonly nightMultiplier: Decimal
  readonly holidayMultiplier: Decimal
}

export interface GangMember {
  readonly workerId: string
  /**
   * Bags handled by this worker. Required for BY_INDIVIDUAL_COUNT, ignored for EQUAL.
   * Itself derived from the confirmed count — never independently entered.
   */
  readonly individualCount: number
}

export interface EarningsInput {
  /** THE CONFIRMED COUNT. Derived from the store keeper's confirmation, never re-keyed. */
  readonly confirmedKeshaCount: KeshaCount
  readonly rate: PieceRateVersion
  readonly members: readonly GangMember[]
  readonly splitMethod: SplitMethod
  readonly isOvertime: boolean
  readonly isNightShift: boolean
  readonly isHoliday: boolean
}

export interface WorkerEarning {
  readonly workerId: string
  readonly share: Money
  /** Bags attributed to this worker — on the voucher so a worker can check their own line. */
  readonly attributedCount: number
}

export interface EarningsResult {
  readonly confirmedKeshaCount: KeshaCount
  readonly baseAmount: Money
  readonly appliedMultiplier: Decimal
  readonly grossAmount: Money
  readonly splitMethod: SplitMethod
  readonly perWorker: readonly WorkerEarning[]
  /** The version used, stored on the activity so an old voucher reproduces exactly. */
  readonly pieceRateVersionId: string
}

/**
 * Compute a gang's earnings.
 *
 * Multipliers COMPOUND rather than taking the maximum: a night shift on a public holiday
 * with overtime is genuinely three premiums, and a plant that pays only the largest of them
 * will be corrected by its workforce.
 * ⚠️ CONFIRM with EthioStar — open question 5 covers the multiplier values AND whether they
 * compound or the highest applies.
 */
export function calculateEarnings(input: EarningsInput): EarningsResult {
  input.confirmedKeshaCount.assertNonNegative('confirmed kesha count')

  if (input.members.length === 0) {
    throw new BusinessRuleViolation(ERROR_CODES.GANG_HAS_NO_MEMBERS, {
      message: 'A gang must have at least one member before earnings can be calculated.',
    })
  }

  const baseAmount = input.rate.amountPerKesha.timesCount(input.confirmedKeshaCount.toNumber())

  let multiplier = Decimal.parse('1.000', 3)
  if (input.isOvertime) multiplier = multiplier.multiply(input.rate.overtimeMultiplier)
  if (input.isNightShift) multiplier = multiplier.multiply(input.rate.nightMultiplier)
  if (input.isHoliday) multiplier = multiplier.multiply(input.rate.holidayMultiplier)

  const grossAmount = baseAmount.timesRate(multiplier)

  return {
    confirmedKeshaCount: input.confirmedKeshaCount,
    baseAmount,
    appliedMultiplier: multiplier,
    grossAmount,
    splitMethod: input.splitMethod,
    perWorker: splitAcrossGang(grossAmount, input),
    pieceRateVersionId: input.rate.id,
  }
}

/**
 * Split the gross across the gang so the shares sum EXACTLY back to it.
 *
 * `Money.allocate` distributes the remainder rather than losing it — 100.00 ETB across
 * three workers is 33.34 + 33.33 + 33.33, not three lossy thirds. Cents that vanish in a
 * split are cents a worker notices.
 */
function splitAcrossGang(gross: Money, input: EarningsInput): WorkerEarning[] {
  const { members, splitMethod, confirmedKeshaCount } = input

  if (splitMethod === 'EQUAL') {
    const shares = gross.allocate(members.length)
    const countShares = distributeCount(confirmedKeshaCount.toNumber(), members.length)

    return members.map((member, index) => ({
      workerId: member.workerId,
      share: shares[index] as Money,
      attributedCount: countShares[index] as number,
    }))
  }

  const weights = members.map((m) => m.individualCount)
  const total = weights.reduce((a, b) => a + b, 0)

  if (total === 0) {
    throw new BusinessRuleViolation(ERROR_CODES.LABOUR_QUANTITY_NOT_DERIVED, {
      message:
        'Splitting by individual count requires a recorded count for at least one worker.',
    })
  }

  if (total !== confirmedKeshaCount.toNumber()) {
    // The individual counts ARE the confirmed count, broken down. If they disagree, one of
    // the two was entered independently — which is precisely what the key control forbids.
    throw new BusinessRuleViolation(ERROR_CODES.LABOUR_QUANTITY_NOT_DERIVED, {
      message:
        'Individual worker counts must sum to the confirmed kesha count. Labour quantities are never entered independently.',
      details: {
        confirmedKeshaCount: confirmedKeshaCount.toNumber(),
        sumOfIndividualCounts: total,
      },
    })
  }

  const shares = gross.allocateByWeights(weights)

  return members.map((member, index) => ({
    workerId: member.workerId,
    share: shares[index] as Money,
    attributedCount: member.individualCount,
  }))
}

/** Distribute a whole count across n workers so the parts sum exactly to the total. */
function distributeCount(total: number, parts: number): number[] {
  const base = Math.floor(total / parts)
  let remainder = total - base * parts

  return Array.from({ length: parts }, () => {
    const extra = remainder > 0 ? 1 : 0
    remainder -= extra
    return base + extra
  })
}

/**
 * A correction never edits an existing activity.
 *
 * When the underlying operational count is corrected, a NEW activity is raised referencing
 * the original, so the voucher history stays explicable — "why did this worker's pay
 * change?" must always have an answer that points at a document.
 */
export interface LabourCorrection {
  readonly originalActivityId: string
  readonly deltaKeshaCount: KeshaCount
  readonly reasonCodeId: string
  readonly narrative: string
}

export function assertCorrectionIsValid(correction: LabourCorrection): void {
  if (correction.deltaKeshaCount.isZero()) {
    throw new BusinessRuleViolation(ERROR_CODES.LABOUR_QUANTITY_NOT_DERIVED, {
      message: 'A correction must change the count.',
    })
  }

  if (!correction.reasonCodeId || correction.narrative.trim().length < 10) {
    throw new BusinessRuleViolation(ERROR_CODES.ADJUSTMENT_REASON_REQUIRED, {
      message: 'A labour correction requires a reason code and a written explanation.',
    })
  }
}

/** Total payable across several activities — the voucher figure. */
export function voucherTotal(results: readonly EarningsResult[]): Money {
  return Money.sum(results.map((r) => r.grossAmount))
}
