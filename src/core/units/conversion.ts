import { Decimal } from './decimal'
import { KeshaCount } from './kesha'
import { Weight } from './weight'
import { WEIGHT_DECIMAL_PLACES } from './scales'

/**
 * Dual-unit recording: kilograms and kesha.
 *
 * These are NOT redundant. kg is the commercial quantity and the mass-balance unit; kesha is
 * the physical count the store keeper verifies and the basis of labour pay.
 *
 * THE RULE THAT MATTERS: a recorded weight is never derived from a bag count. The client
 * document requires "the ability to record actual rather than assumed weight" — so the
 * standard net weight per bag type is used only for *estimation* and for flagging outliers,
 * never to compute a figure that goes on a Goods Receiving Note.
 *
 * docs/architecture/03-domain-model.md §3.7
 */

/** Average kilograms per kesha, as recorded on every receipt. */
export function averageKgPerKesha(weight: Weight, count: KeshaCount): Weight | null {
  if (count.isZero()) return null
  return weight.perCount(count.toNumber())
}

/**
 * Estimated weight from a bag count and a bag type's standard net weight.
 * For capacity planning and outlier checks ONLY — never persisted as a recorded weight.
 */
export function estimateWeightFromKesha(
  count: KeshaCount,
  standardNetWeightKg: Weight,
): Weight {
  count.assertNonNegative('kesha count')
  return standardNetWeightKg.timesCount(count.toNumber())
}

/**
 * Estimated bag count from a weight — for a proposed delivery whose bags are not yet counted.
 * Rounds up: half a bag still occupies a whole bag's space.
 */
export function estimateKeshaFromWeight(
  weight: Weight,
  standardNetWeightKg: Weight,
): KeshaCount {
  if (!standardNetWeightKg.isPositive()) {
    throw new RangeError('Standard net weight per kesha must be greater than zero')
  }
  const ratio = weight.decimal.percentOf(standardNetWeightKg.decimal, 6)
  // percentOf returns a percentage; divide by 100 and round up.
  const exact = ratio.toNumberUnsafe() / 100
  return KeshaCount.from(Math.ceil(exact))
}

export interface WeightOutlierCheck {
  readonly isOutlier: boolean
  /** Actual average kg per kesha, or null when the count is zero. */
  readonly actualAverage: Weight | null
  readonly standard: Weight
  /** Signed deviation as a percentage of the standard. */
  readonly deviationPct: Decimal | null
  readonly thresholdPct: Decimal
}

/**
 * Flags a receipt whose average bag weight diverges from the bag type's standard.
 *
 * A soft warning at capture and a hard flag on the exception register — this is how a
 * mis-keyed weight or a mis-counted bag is caught at the bay rather than at reconciliation.
 */
export function checkAverageWeightOutlier(
  weight: Weight,
  count: KeshaCount,
  standardNetWeightKg: Weight,
  thresholdPct: Decimal,
): WeightOutlierCheck {
  const actualAverage = averageKgPerKesha(weight, count)

  if (actualAverage === null || !standardNetWeightKg.isPositive()) {
    return {
      isOutlier: false,
      actualAverage,
      standard: standardNetWeightKg,
      deviationPct: null,
      thresholdPct,
    }
  }

  const difference = actualAverage.subtract(standardNetWeightKg)
  const deviationPct = difference.abs().percentOf(standardNetWeightKg)
  const signedDeviation = difference.isNegative() ? deviationPct.negate() : deviationPct

  return {
    isOutlier: deviationPct.greaterThan(thresholdPct.rescale(deviationPct.scale)),
    actualAverage,
    standard: standardNetWeightKg,
    deviationPct: signedDeviation,
    thresholdPct,
  }
}

/** A quantity recorded in both units — the shape every operational line carries. */
export interface DualQuantity {
  readonly weight: Weight
  readonly kesha: KeshaCount
}

export function dualQuantity(weight: Weight, kesha: KeshaCount): DualQuantity {
  return { weight, kesha }
}

export function addDual(a: DualQuantity, b: DualQuantity): DualQuantity {
  return { weight: a.weight.add(b.weight), kesha: a.kesha.add(b.kesha) }
}

export function subtractDual(a: DualQuantity, b: DualQuantity): DualQuantity {
  return { weight: a.weight.subtract(b.weight), kesha: a.kesha.subtract(b.kesha) }
}

export function negateDual(a: DualQuantity): DualQuantity {
  return { weight: a.weight.negate(), kesha: a.kesha.negate() }
}

export function sumDual(quantities: readonly DualQuantity[]): DualQuantity {
  return quantities.reduce<DualQuantity>(addDual, {
    weight: Weight.zero(),
    kesha: KeshaCount.zero(),
  })
}

export function isDualZero(q: DualQuantity): boolean {
  return q.weight.isZero() && q.kesha.isZero()
}

export const ZERO_DUAL: DualQuantity = {
  weight: Weight.zero(),
  kesha: KeshaCount.zero(),
}

export { WEIGHT_DECIMAL_PLACES }
