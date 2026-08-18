import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { Decimal } from '@core/units/decimal'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

/**
 * M12 — the capacity engine.
 *
 * "It answers the two questions that stop the business when they cannot be answered:
 * 'where is it?' and 'will it fit?'"
 *
 * THE KEY IDEA IS RESERVATIONS. Without them, ten delivery requests approved on Monday all
 * "fit" and none of them do on Friday. Approving a request reserves the space, so the next
 * capacity check sees it — which is what makes the pre-arrival check honest rather than
 * optimistic.
 *
 * docs/architecture/03-domain-model.md §3.5
 */

export interface CapacityFigures {
  /** Physical maximum. */
  readonly capacityKg: Weight
  readonly capacityKesha: KeshaCount
  /** Currently in the location — the sum of stock balances at or below this node. */
  readonly occupiedKg: Weight
  readonly occupiedKesha: KeshaCount
  /** Committed to approved-but-not-yet-arrived consignments. */
  readonly reservedKg: Weight
  readonly reservedKesha: KeshaCount
  /**
   * Fraction of physical capacity that may be used, e.g. 0.90.
   * "configurable safe-fill thresholds and automatic alerts as a room approaches full."
   */
  readonly safeFillPct: Decimal
}

export interface AvailableCapacity {
  readonly availableKg: Weight
  readonly availableKesha: KeshaCount
  /** Usable capacity after applying the safe-fill threshold. */
  readonly usableKg: Weight
  readonly usableKesha: KeshaCount
  /** Occupancy as a percentage of PHYSICAL capacity, for the occupancy display. */
  readonly occupancyPct: Decimal
  /** True once occupancy plus reservations reaches the safe-fill threshold. */
  readonly atSafeFillThreshold: boolean
}

/**
 * available = capacity × safe-fill − occupied − reserved
 *
 * Clamped at zero: an over-filled room reports zero available, never a negative that a
 * caller might treat as a number to add to.
 */
export function computeAvailable(figures: CapacityFigures): AvailableCapacity {
  const usableKg = applySafeFill(figures.capacityKg, figures.safeFillPct)
  const usableKesha = applySafeFillToCount(figures.capacityKesha, figures.safeFillPct)

  const committedKg = figures.occupiedKg.add(figures.reservedKg)
  const committedKesha = figures.occupiedKesha.add(figures.reservedKesha)

  const rawAvailableKg = usableKg.subtract(committedKg)
  const rawAvailableKesha = usableKesha.subtract(committedKesha)

  const availableKg = rawAvailableKg.isNegative() ? Weight.zero() : rawAvailableKg
  const availableKesha = rawAvailableKesha.isNegative() ? KeshaCount.zero() : rawAvailableKesha

  const occupancyPct = figures.capacityKg.isZero()
    ? Decimal.zero(3)
    : figures.occupiedKg.percentOf(figures.capacityKg)

  return {
    availableKg,
    availableKesha,
    usableKg,
    usableKesha,
    occupancyPct,
    atSafeFillThreshold:
      committedKg.greaterThanOrEqual(usableKg) ||
      committedKesha.greaterThanOrEqual(usableKesha),
  }
}

function applySafeFill(capacity: Weight, safeFillPct: Decimal): Weight {
  // safeFillPct is a fraction (0.900), not a percentage (90.000).
  return Weight.fromKg(
    capacity.decimal.multiply(safeFillPct.rescale(capacity.decimal.scale)).toString(),
  )
}

function applySafeFillToCount(capacity: KeshaCount, safeFillPct: Decimal): KeshaCount {
  const scaled = Decimal.fromInteger(capacity.toNumber(), 3).multiply(safeFillPct.rescale(3))
  // Floor: a partly-usable bag slot is not a bag slot.
  return KeshaCount.from(Math.floor(Number(scaled.toString())))
}

export interface CapacityRequest {
  readonly quantityKg: Weight
  readonly keshaCount: KeshaCount
}

export type CapacityCheckResult =
  | { readonly fits: true; readonly available: AvailableCapacity }
  | {
      readonly fits: false
      readonly available: AvailableCapacity
      /** Why it does not fit, in terms a Customer Service Officer can relay. */
      readonly reason: 'INSUFFICIENT_WEIGHT' | 'INSUFFICIENT_KESHA' | 'BOTH'
      readonly shortfallKg: Weight
      readonly shortfallKesha: KeshaCount
    }

/**
 * Does `request` fit in this location?
 *
 * Both units are checked independently: a room can have weight capacity left but no floor
 * space for more bags, and refusing on the wrong axis produces a confusing message.
 */
export function checkFit(
  figures: CapacityFigures,
  request: CapacityRequest,
): CapacityCheckResult {
  const available = computeAvailable(figures)

  const weightFits = request.quantityKg.lessThanOrEqual(available.availableKg)
  const keshaFits = request.keshaCount.lessThanOrEqual(available.availableKesha)

  if (weightFits && keshaFits) {
    return { fits: true, available }
  }

  const shortfallKg = weightFits
    ? Weight.zero()
    : request.quantityKg.subtract(available.availableKg)
  const shortfallKesha = keshaFits
    ? KeshaCount.zero()
    : request.keshaCount.subtract(available.availableKesha)

  return {
    fits: false,
    available,
    reason:
      !weightFits && !keshaFits
        ? 'BOTH'
        : !weightFits
          ? 'INSUFFICIENT_WEIGHT'
          : 'INSUFFICIENT_KESHA',
    shortfallKg,
    shortfallKesha,
  }
}

/** Throwing form, for use cases that must refuse rather than report. */
export function assertFits(
  figures: CapacityFigures,
  request: CapacityRequest,
  locationLabel: string,
): void {
  const result = checkFit(figures, request)
  if (result.fits) return

  throw new BusinessRuleViolation(ERROR_CODES.INSUFFICIENT_CAPACITY, {
    message: `${locationLabel} does not have space for this consignment.`,
    details: {
      location: locationLabel,
      reason: result.reason,
      requestedKg: request.quantityKg.toKgString(),
      requestedKesha: request.keshaCount.toNumber(),
      availableKg: result.available.availableKg.toKgString(),
      availableKesha: result.available.availableKesha.toNumber(),
      shortfallKg: result.shortfallKg.toKgString(),
      shortfallKesha: result.shortfallKesha.toNumber(),
    },
  })
}

/** Aggregate child figures into a parent node (section → room → warehouse). */
export function rollUp(children: readonly CapacityFigures[]): CapacityFigures {
  if (children.length === 0) {
    return {
      capacityKg: Weight.zero(),
      capacityKesha: KeshaCount.zero(),
      occupiedKg: Weight.zero(),
      occupiedKesha: KeshaCount.zero(),
      reservedKg: Weight.zero(),
      reservedKesha: KeshaCount.zero(),
      safeFillPct: Decimal.parse('1.000', 3),
    }
  }

  return {
    capacityKg: Weight.sum(children.map((c) => c.capacityKg)),
    capacityKesha: KeshaCount.sum(children.map((c) => c.capacityKesha)),
    occupiedKg: Weight.sum(children.map((c) => c.occupiedKg)),
    occupiedKesha: KeshaCount.sum(children.map((c) => c.occupiedKesha)),
    reservedKg: Weight.sum(children.map((c) => c.reservedKg)),
    reservedKesha: KeshaCount.sum(children.map((c) => c.reservedKesha)),
    // The tightest child threshold governs the parent: a roll-up must not imply more
    // headroom than the most constrained section actually has.
    safeFillPct: children.reduce(
      (tightest, c) => (c.safeFillPct.lessThan(tightest) ? c.safeFillPct : tightest),
      children[0]!.safeFillPct,
    ),
  }
}
