import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { computeAvailable, type CapacityFigures, type CapacityRequest } from './capacity'

/**
 * Placement proposal (M12).
 *
 * The client document requires the system to "either propose a storage plan or refuse the
 * date with the reason" — so `checkAvailability` returns a PROPOSAL, not a boolean. A
 * Customer Service Officer needs to tell the customer where the coffee will go, not just
 * that it fits somewhere.
 *
 * `PlacementStrategy` is a PORT with one Phase 1 implementation. Phase 3's M26 optimal-
 * placement recommender ("taking into account expected dwell time, planned processing date
 * and the movement cost of a bad placement") is a second implementation of this same
 * interface and needs no other change.
 * docs/architecture/07-extension-points.md
 */

export interface CandidateLocation {
  readonly locationId: string
  /** Human-readable, e.g. "Warehouse A · Room 2 · Section C". */
  readonly label: string
  readonly roomId: string
  readonly warehouseId: string
  readonly figures: CapacityFigures
  /** Lots already stored here for this customer — used for same-customer affinity. */
  readonly existingCustomerLots: number
}

export interface PlacementLine {
  readonly locationId: string
  readonly label: string
  readonly quantityKg: Weight
  readonly keshaCount: KeshaCount
}

export type PlacementProposal =
  | { readonly satisfied: true; readonly lines: readonly PlacementLine[] }
  | {
      readonly satisfied: false
      /** What CAN be placed — useful when the officer wants a partial acceptance. */
      readonly lines: readonly PlacementLine[]
      readonly unplacedKg: Weight
      readonly unplacedKesha: KeshaCount
      readonly reason: string
    }

export interface PlacementContext {
  readonly customerId: string
  readonly request: CapacityRequest
  readonly candidates: readonly CandidateLocation[]
}

export interface PlacementStrategy {
  readonly name: string
  propose(context: PlacementContext): PlacementProposal
}

/**
 * The Phase 1 strategy: best-fit with same-customer affinity, fewest splits.
 *
 * Ordering rationale, in priority order:
 *   1. Locations already holding this customer's coffee. Keeping one customer's stock
 *      together makes the store keeper's life easier and reduces mis-picks.
 *   2. Smallest sufficient location (best fit), so large contiguous space is preserved for
 *      consignments that actually need it.
 *   3. Largest available, as the fallback when nothing fits whole and the load must split.
 *
 * A split is a real operational cost — more label printing, more walking, more chance of a
 * mis-pick — so the strategy minimises the number of lines, not the wasted space.
 */
export class BestFitPlacementStrategy implements PlacementStrategy {
  readonly name = 'best-fit-with-customer-affinity'

  propose(context: PlacementContext): PlacementProposal {
    const { request, candidates } = context

    const usable = candidates
      .map((candidate) => ({ candidate, available: computeAvailable(candidate.figures) }))
      .filter(
        ({ available }) =>
          available.availableKg.isPositive() && available.availableKesha.isPositive(),
      )

    // 1. A single location that takes the whole consignment — always preferred.
    const wholeFit = this.findBestWholeFit(usable, request)
    if (wholeFit) {
      return {
        satisfied: true,
        lines: [
          {
            locationId: wholeFit.candidate.locationId,
            label: wholeFit.candidate.label,
            quantityKg: request.quantityKg,
            keshaCount: request.keshaCount,
          },
        ],
      }
    }

    // 2. Otherwise split across the largest locations first, to minimise the line count.
    return this.splitAcross(usable, request)
  }

  private findBestWholeFit(
    usable: ReadonlyArray<{
      candidate: CandidateLocation
      available: ReturnType<typeof computeAvailable>
    }>,
    request: CapacityRequest,
  ): { candidate: CandidateLocation } | null {
    const fitting = usable.filter(
      ({ available }) =>
        request.quantityKg.lessThanOrEqual(available.availableKg) &&
        request.keshaCount.lessThanOrEqual(available.availableKesha),
    )

    if (fitting.length === 0) return null

    const sorted = [...fitting].sort((a, b) => {
      // Same-customer affinity first.
      const affinity = b.candidate.existingCustomerLots - a.candidate.existingCustomerLots
      if (affinity !== 0) return affinity
      // Then best fit: the smallest location that still takes it.
      return a.available.availableKg.compare(b.available.availableKg)
    })

    return { candidate: (sorted[0] as (typeof sorted)[number]).candidate }
  }

  private splitAcross(
    usable: ReadonlyArray<{
      candidate: CandidateLocation
      available: ReturnType<typeof computeAvailable>
    }>,
    request: CapacityRequest,
  ): PlacementProposal {
    // Largest first minimises the number of splits.
    const sorted = [...usable].sort((a, b) =>
      b.available.availableKg.compare(a.available.availableKg),
    )

    const lines: PlacementLine[] = []
    let remainingKg = request.quantityKg
    let remainingKesha = request.keshaCount

    for (const { candidate, available } of sorted) {
      if (!remainingKg.isPositive() && !remainingKesha.isPositive()) break

      const takeKg = remainingKg.lessThanOrEqual(available.availableKg)
        ? remainingKg
        : available.availableKg
      const takeKesha = remainingKesha.lessThanOrEqual(available.availableKesha)
        ? remainingKesha
        : available.availableKesha

      if (!takeKg.isPositive() || !takeKesha.isPositive()) continue

      lines.push({
        locationId: candidate.locationId,
        label: candidate.label,
        quantityKg: takeKg,
        keshaCount: takeKesha,
      })

      remainingKg = remainingKg.subtract(takeKg)
      remainingKesha = remainingKesha.subtract(takeKesha)
    }

    const fullyPlaced = !remainingKg.isPositive() && !remainingKesha.isPositive()

    if (fullyPlaced) {
      return { satisfied: true, lines }
    }

    return {
      satisfied: false,
      lines,
      unplacedKg: remainingKg.isNegative() ? Weight.zero() : remainingKg,
      unplacedKesha: remainingKesha.isNegative() ? KeshaCount.zero() : remainingKesha,
      reason:
        lines.length === 0
          ? 'No storage location has available space for this consignment.'
          : 'Available space is insufficient; only part of the consignment can be placed.',
    }
  }
}

/** Total quantity a proposal actually places — used to verify it never over-commits. */
export function proposalTotals(proposal: PlacementProposal): {
  quantityKg: Weight
  keshaCount: KeshaCount
} {
  return {
    quantityKg: Weight.sum(proposal.lines.map((l) => l.quantityKg)),
    keshaCount: KeshaCount.sum(proposal.lines.map((l) => l.keshaCount)),
  }
}
