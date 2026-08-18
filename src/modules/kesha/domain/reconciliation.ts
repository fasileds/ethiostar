import { KeshaCount } from '@core/units/kesha'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

/**
 * M13 — bag reconciliation.
 *
 * The key control, verbatim: "Bag counts must reconcile: bags received plus bags issued
 * must equal bags filled plus bags returned plus bags condemned, and any difference must be
 * explained."
 *
 * Bags matter because "loading and unloading labour is paid per kesha", so a bag count is
 * the basis of a direct cash outflow — not merely a stores figure.
 */

export interface BagMovements {
  /** Bags arriving with the customer's coffee. */
  readonly received: KeshaCount
  /** EthioStar's own empty bags issued to the operation. */
  readonly issued: KeshaCount
  /** Bags filled with coffee (received lots and processing outputs). */
  readonly filled: KeshaCount
  /** Customer-owned bags handed back at dispatch. */
  readonly returned: KeshaCount
  /** Bags taken out of service — torn, contaminated, water damaged. */
  readonly condemned: KeshaCount
}

export interface ReconciliationResult {
  readonly inputTotal: KeshaCount
  readonly outputTotal: KeshaCount
  /** (received + issued) − (filled + returned + condemned). Zero when reconciled. */
  readonly variance: KeshaCount
  readonly balanced: boolean
}

/**
 * received + issued = filled + returned + condemned
 *
 * A non-zero variance is not an error in itself — bags genuinely go missing on a loading
 * bay. It is a figure that must be EXPLAINED before the reconciliation can be closed.
 */
export function reconcile(movements: BagMovements): ReconciliationResult {
  const inputTotal = movements.received.add(movements.issued)
  const outputTotal = movements.filled.add(movements.returned).add(movements.condemned)
  const variance = inputTotal.subtract(outputTotal)

  return {
    inputTotal,
    outputTotal,
    variance,
    balanced: variance.isZero(),
  }
}

export interface CloseReconciliationInput {
  readonly result: ReconciliationResult
  readonly varianceReasonCodeId: string | null
  readonly varianceNarrative: string | null
}

/**
 * THE M13 KEY CONTROL: a reconciliation cannot be closed with an unexplained difference.
 */
export function assertMayCloseReconciliation(input: CloseReconciliationInput): void {
  if (input.result.balanced) return

  const narrative = input.varianceNarrative?.trim() ?? ''

  if (!input.varianceReasonCodeId || narrative.length < 10) {
    throw new BusinessRuleViolation(ERROR_CODES.BAG_RECONCILIATION_IMBALANCE, {
      message:
        'Bag counts do not reconcile. Explain the difference with a reason code and a written note before closing.',
      details: {
        inputTotal: input.result.inputTotal.toNumber(),
        outputTotal: input.result.outputTotal.toNumber(),
        variance: input.result.variance.toNumber(),
        direction: input.result.variance.isPositive()
          ? 'BAGS_MISSING'
          : 'BAGS_UNACCOUNTED_GAIN',
      },
    })
  }
}

/** Empty-bag stock cannot go negative: you cannot issue bags you do not hold. */
export function assertSufficientEmptyBags(
  available: KeshaCount,
  requested: KeshaCount,
  bagTypeLabel: string,
): void {
  if (requested.greaterThan(available)) {
    throw new BusinessRuleViolation(ERROR_CODES.INSUFFICIENT_EMPTY_BAGS, {
      message: `Not enough ${bagTypeLabel} bags in stock.`,
      details: {
        bagType: bagTypeLabel,
        available: available.toNumber(),
        requested: requested.toNumber(),
      },
    })
  }
}

/**
 * Customer-owned returnable bags outstanding at dispatch.
 *
 * "including returnable bags to be given back on dispatch" — the loading list prints this
 * so the driver leaves with the customer's own bags, not EthioStar's.
 */
export function outstandingReturnableBags(
  receivedFromCustomer: KeshaCount,
  alreadyReturned: KeshaCount,
): KeshaCount {
  const outstanding = receivedFromCustomer.subtract(alreadyReturned)
  return outstanding.isNegative() ? KeshaCount.zero() : outstanding
}
