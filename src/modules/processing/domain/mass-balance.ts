import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { Decimal } from '@core/units/decimal'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

/**
 * M15 — yield and mass-balance reconciliation.
 *
 * The key control, verbatim: "A job cannot be closed while the mass balance is outside
 * tolerance and unexplained."
 *
 * "input weight compared against the sum of all outputs plus recorded process loss. Any
 * unexplained difference beyond tolerance is flagged and must be explained before the job
 * can be closed — this is the control that makes weight disputes rare."
 *
 * docs/architecture/03-domain-model.md §3.6
 */

export interface OutputLine {
  /** Stable code from `output_classification` — APPROVED, C_GRADE, GRAVITY, COLOUR_SORTER. */
  readonly classificationCode: string
  readonly quantityKg: Weight
  readonly keshaCount: KeshaCount
  readonly bagTypeId: string
  readonly locationId: string
}

export interface LossLine {
  readonly reasonCodeId: string
  readonly quantityKg: Weight
}

export interface MassBalanceInput {
  readonly inputKg: Weight
  readonly outputs: readonly OutputLine[]
  readonly losses: readonly LossLine[]
  /** From `system_setting`, overridable per coffee type. */
  readonly tolerancePct: Decimal
}

export interface YieldLine {
  readonly classificationCode: string
  readonly quantityKg: Weight
  readonly keshaCount: KeshaCount
  /** output / input × 100. */
  readonly yieldPct: Decimal
}

export interface MassBalanceResult {
  readonly inputKg: Weight
  readonly outputKg: Weight
  readonly lossKg: Weight
  /** input − outputs − loss. Zero when perfectly balanced. */
  readonly varianceKg: Weight
  /** |variance| / input × 100. */
  readonly variancePct: Decimal
  readonly tolerancePct: Decimal
  readonly withinTolerance: boolean
  readonly yields: readonly YieldLine[]
  /** Loss as a percentage of input — reported on the yield statement. */
  readonly lossPct: Decimal
}

/**
 * Compute the balance. Pure: no I/O, no clock, no database.
 *
 * A zero input is rejected rather than returning a meaningless 0% yield — a job with no
 * input is a data error, not a job with perfect yield.
 */
export function computeMassBalance(input: MassBalanceInput): MassBalanceResult {
  if (!input.inputKg.isPositive()) {
    throw new BusinessRuleViolation(ERROR_CODES.NO_OUTPUTS_RECORDED, {
      message: 'A job must have a positive input weight before its balance can be computed.',
    })
  }

  const outputKg = Weight.sum(input.outputs.map((o) => o.quantityKg))
  const lossKg = Weight.sum(input.losses.map((l) => l.quantityKg))

  const varianceKg = input.inputKg.subtract(outputKg).subtract(lossKg)
  const variancePct = varianceKg.abs().percentOf(input.inputKg)

  const yields = input.outputs.map((output): YieldLine => ({
    classificationCode: output.classificationCode,
    quantityKg: output.quantityKg,
    keshaCount: output.keshaCount,
    yieldPct: output.quantityKg.percentOf(input.inputKg),
  }))

  return {
    inputKg: input.inputKg,
    outputKg,
    lossKg,
    varianceKg,
    variancePct,
    tolerancePct: input.tolerancePct,
    withinTolerance: variancePct.lessThanOrEqual(input.tolerancePct.rescale(variancePct.scale)),
    yields,
    lossPct: lossKg.percentOf(input.inputKg),
  }
}

export interface CloseJobContext {
  readonly balance: MassBalanceResult
  /** Explanation supplied by the operator when the balance is out of tolerance. */
  readonly varianceExplanation: string | null
  readonly varianceReasonCodeId: string | null
  /**
   * Whether the actor holds `job_order:close_with_variance` — a DIFFERENT permission from
   * `job_order:close`. That separation is what makes the exception report meaningful.
   */
  readonly mayCloseWithVariance: boolean
}

/**
 * THE M15 KEY CONTROL.
 *
 * Within tolerance → close.
 * Outside tolerance → close only with an explanation, a reason code, and the higher
 * permission. Anything else refuses.
 */
export function assertMayClose(context: CloseJobContext): void {
  const { balance } = context

  if (balance.outputKg.isZero() && balance.lossKg.isZero()) {
    throw new BusinessRuleViolation(ERROR_CODES.NO_OUTPUTS_RECORDED, {
      message: 'Record the processing outputs before closing the job.',
    })
  }

  if (balance.withinTolerance) return

  if (!context.mayCloseWithVariance) {
    throw new BusinessRuleViolation(ERROR_CODES.MASS_BALANCE_OUT_OF_TOLERANCE, {
      message:
        'The mass balance is outside tolerance. Closing this job requires authorisation.',
      details: describeVariance(balance),
    })
  }

  const explanation = context.varianceExplanation?.trim() ?? ''

  if (explanation.length < 10 || !context.varianceReasonCodeId) {
    throw new BusinessRuleViolation(ERROR_CODES.VARIANCE_EXPLANATION_REQUIRED, {
      message:
        'A mass-balance variance must be explained with a reason code and a written note before the job can be closed.',
      details: describeVariance(balance),
    })
  }
}

function describeVariance(balance: MassBalanceResult): Record<string, unknown> {
  return {
    inputKg: balance.inputKg.toKgString(),
    outputKg: balance.outputKg.toKgString(),
    lossKg: balance.lossKg.toKgString(),
    varianceKg: balance.varianceKg.toKgString(),
    variancePct: balance.variancePct.toString(),
    tolerancePct: balance.tolerancePct.toString(),
    direction: balance.varianceKg.isPositive() ? 'SHORT' : 'OVER',
  }
}

/**
 * Non-throwing form for the live display during job execution — the operator sees the
 * running balance change as each output is weighed, rather than discovering a problem at
 * close.
 */
export function varianceStatus(
  balance: MassBalanceResult,
): 'BALANCED' | 'WITHIN_TOLERANCE' | 'OUT_OF_TOLERANCE' {
  if (balance.varianceKg.isZero()) return 'BALANCED'
  return balance.withinTolerance ? 'WITHIN_TOLERANCE' : 'OUT_OF_TOLERANCE'
}

/**
 * Flag an output whose yield diverges materially from the expected share for its
 * classification.
 *
 * A job can be perfectly balanced overall and still be wrong — 90% approved on a lot that
 * normally yields 80% means an output was misclassified. Within-tolerance-but-abnormal is
 * exactly what M27 (Phase 3) learns to detect; this is the fixed-threshold version.
 */
export function detectYieldOutliers(
  yields: readonly YieldLine[],
  expected: ReadonlyMap<string, Decimal>,
  thresholdPct: Decimal,
): Array<{
  classificationCode: string
  actualPct: Decimal
  expectedPct: Decimal
  deviationPct: Decimal
}> {
  const outliers: Array<{
    classificationCode: string
    actualPct: Decimal
    expectedPct: Decimal
    deviationPct: Decimal
  }> = []

  for (const line of yields) {
    const expectedPct = expected.get(line.classificationCode)
    if (!expectedPct) continue

    const deviation = line.yieldPct.subtract(expectedPct.rescale(line.yieldPct.scale))
    if (deviation.abs().greaterThan(thresholdPct.rescale(deviation.scale))) {
      outliers.push({
        classificationCode: line.classificationCode,
        actualPct: line.yieldPct,
        expectedPct,
        deviationPct: deviation,
      })
    }
  }

  return outliers
}

/**
 * The yield statement snapshot, stored on the job at close.
 *
 * Snapshotted so that later master-data edits cannot retroactively change a historical
 * yield statement — the same principle as printed-document payload snapshots.
 */
export interface YieldSnapshot {
  readonly inputKg: string
  readonly outputKg: string
  readonly lossKg: string
  readonly varianceKg: string
  readonly variancePct: string
  readonly tolerancePct: string
  readonly withinTolerance: boolean
  readonly lines: ReadonlyArray<{
    classificationCode: string
    quantityKg: string
    keshaCount: number
    yieldPct: string
  }>
}

export function toYieldSnapshot(balance: MassBalanceResult): YieldSnapshot {
  return {
    inputKg: balance.inputKg.toKgString(),
    outputKg: balance.outputKg.toKgString(),
    lossKg: balance.lossKg.toKgString(),
    varianceKg: balance.varianceKg.toKgString(),
    variancePct: balance.variancePct.toString(),
    tolerancePct: balance.tolerancePct.toString(),
    withinTolerance: balance.withinTolerance,
    lines: balance.yields.map((y) => ({
      classificationCode: y.classificationCode,
      quantityKg: y.quantityKg.toKgString(),
      keshaCount: y.keshaCount.toNumber(),
      yieldPct: y.yieldPct.toString(),
    })),
  }
}
