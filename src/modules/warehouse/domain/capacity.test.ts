import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  computeAvailable,
  checkFit,
  assertFits,
  rollUp,
  type CapacityFigures,
} from './capacity'
import { BestFitPlacementStrategy, proposalTotals, type CandidateLocation } from './placement'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { Decimal } from '@core/units/decimal'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

const kg = Weight.fromKg
const ks = KeshaCount.from
const pct = (v: string) => Decimal.parse(v, 3)

function figures(overrides: Partial<CapacityFigures> = {}): CapacityFigures {
  return {
    capacityKg: kg('100000'),
    capacityKesha: ks(2000),
    occupiedKg: Weight.zero(),
    occupiedKesha: KeshaCount.zero(),
    reservedKg: Weight.zero(),
    reservedKesha: KeshaCount.zero(),
    safeFillPct: pct('1.000'),
    ...overrides,
  }
}

describe('computeAvailable — available = capacity × safe-fill − occupied − reserved', () => {
  it('reports full capacity when empty with no safe-fill limit', () => {
    const a = computeAvailable(figures())
    expect(a.availableKg.toKgString()).toBe('100000.000')
    expect(a.availableKesha.toNumber()).toBe(2000)
  })

  it('subtracts occupied stock', () => {
    const a = computeAvailable(figures({ occupiedKg: kg('30000'), occupiedKesha: ks(500) }))
    expect(a.availableKg.toKgString()).toBe('70000.000')
    expect(a.availableKesha.toNumber()).toBe(1500)
  })

  /**
   * THE RESERVATION POINT. Without reservations, ten requests approved on Monday all "fit"
   * and none of them do on Friday.
   */
  it('subtracts reservations for approved-but-not-yet-arrived consignments', () => {
    const a = computeAvailable(
      figures({
        occupiedKg: kg('30000'),
        occupiedKesha: ks(500),
        reservedKg: kg('20000'),
        reservedKesha: ks(400),
      }),
    )
    expect(a.availableKg.toKgString()).toBe('50000.000')
    expect(a.availableKesha.toNumber()).toBe(1100)
  })

  it('applies the safe-fill threshold', () => {
    const a = computeAvailable(figures({ safeFillPct: pct('0.900') }))
    expect(a.usableKg.toKgString()).toBe('90000.000')
    expect(a.availableKg.toKgString()).toBe('90000.000')
    expect(a.usableKesha.toNumber()).toBe(1800)
  })

  it('floors the kesha safe-fill — a partly-usable bag slot is not a bag slot', () => {
    const a = computeAvailable(figures({ capacityKesha: ks(101), safeFillPct: pct('0.900') }))
    expect(a.usableKesha.toNumber()).toBe(90) // 90.9 floored
  })

  it('clamps at zero rather than reporting negative available space', () => {
    const a = computeAvailable(figures({ occupiedKg: kg('120000'), occupiedKesha: ks(2500) }))
    expect(a.availableKg.isZero()).toBe(true)
    expect(a.availableKesha.isZero()).toBe(true)
  })

  it('computes occupancy against PHYSICAL capacity, not usable capacity', () => {
    const a = computeAvailable(figures({ occupiedKg: kg('45000'), safeFillPct: pct('0.900') }))
    expect(a.occupancyPct.toString()).toBe('45.000')
  })

  it('flags the safe-fill threshold once occupied plus reserved reaches it', () => {
    const under = computeAvailable(
      figures({ occupiedKg: kg('80000'), occupiedKesha: ks(1600), safeFillPct: pct('0.900') }),
    )
    expect(under.atSafeFillThreshold).toBe(false)

    const at = computeAvailable(
      figures({
        occupiedKg: kg('80000'),
        occupiedKesha: ks(1600),
        reservedKg: kg('10000'),
        reservedKesha: ks(200),
        safeFillPct: pct('0.900'),
      }),
    )
    expect(at.atSafeFillThreshold).toBe(true)
  })

  it('handles a zero-capacity location without dividing by zero', () => {
    const a = computeAvailable(
      figures({ capacityKg: Weight.zero(), capacityKesha: KeshaCount.zero() }),
    )
    expect(a.occupancyPct.toString()).toBe('0.000')
    expect(a.availableKg.isZero()).toBe(true)
  })

  it('never reports available space exceeding usable capacity, for any inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        (capacity, occupied, reserved) => {
          const a = computeAvailable(
            figures({
              capacityKg: Weight.fromWholeKg(capacity),
              occupiedKg: Weight.fromWholeKg(occupied),
              reservedKg: Weight.fromWholeKg(reserved),
              safeFillPct: pct('0.900'),
            }),
          )
          expect(a.availableKg.isNegative()).toBe(false)
          expect(a.availableKg.lessThanOrEqual(a.usableKg)).toBe(true)
        },
      ),
    )
  })
})

describe('checkFit — both units are checked independently', () => {
  it('accepts a consignment that fits on both axes', () => {
    const r = checkFit(figures(), { quantityKg: kg('30000'), keshaCount: ks(500) })
    expect(r.fits).toBe(true)
  })

  /** A room can have weight capacity left but no floor space for more bags. */
  it('refuses on kesha alone and says so', () => {
    const r = checkFit(figures({ occupiedKesha: ks(1900) }), {
      quantityKg: kg('1000'),
      keshaCount: ks(200),
    })
    expect(r.fits).toBe(false)
    if (!r.fits) {
      expect(r.reason).toBe('INSUFFICIENT_KESHA')
      expect(r.shortfallKesha.toNumber()).toBe(100)
      expect(r.shortfallKg.isZero()).toBe(true)
    }
  })

  it('refuses on weight alone and says so', () => {
    const r = checkFit(figures({ occupiedKg: kg('95000') }), {
      quantityKg: kg('10000'),
      keshaCount: ks(100),
    })
    expect(r.fits).toBe(false)
    if (!r.fits) {
      expect(r.reason).toBe('INSUFFICIENT_WEIGHT')
      expect(r.shortfallKg.toKgString()).toBe('5000.000')
    }
  })

  it('reports BOTH when neither axis fits', () => {
    const r = checkFit(figures({ occupiedKg: kg('99000'), occupiedKesha: ks(1990) }), {
      quantityKg: kg('5000'),
      keshaCount: ks(100),
    })
    expect(r.fits).toBe(false)
    if (!r.fits) expect(r.reason).toBe('BOTH')
  })

  it('accepts an exact fit', () => {
    const r = checkFit(figures({ occupiedKg: kg('70000'), occupiedKesha: ks(1500) }), {
      quantityKg: kg('30000'),
      keshaCount: ks(500),
    })
    expect(r.fits).toBe(true)
  })
})

describe('assertFits — the M11 control "coffee is never accepted against space that does not exist"', () => {
  it('passes silently when it fits', () => {
    expect(() =>
      assertFits(figures(), { quantityKg: kg('100'), keshaCount: ks(2) }, 'Room 2'),
    ).not.toThrow()
  })

  it('throws with the shortfall named, so the officer can tell the customer', () => {
    try {
      assertFits(
        figures({ occupiedKg: kg('95000') }),
        { quantityKg: kg('10000'), keshaCount: ks(100) },
        'Warehouse A · Room 2',
      )
      expect.unreachable()
    } catch (error) {
      const e = error as BusinessRuleViolation
      expect(e.code).toBe(ERROR_CODES.INSUFFICIENT_CAPACITY)
      expect(e.message).toContain('Warehouse A · Room 2')
      expect(e.details).toMatchObject({
        reason: 'INSUFFICIENT_WEIGHT',
        shortfallKg: '5000.000',
      })
    }
  })
})

describe('rollUp — section → room → warehouse', () => {
  it('sums children', () => {
    const parent = rollUp([
      figures({ capacityKg: kg('50000'), occupiedKg: kg('10000'), capacityKesha: ks(1000) }),
      figures({ capacityKg: kg('30000'), occupiedKg: kg('5000'), capacityKesha: ks(600) }),
    ])
    expect(parent.capacityKg.toKgString()).toBe('80000.000')
    expect(parent.occupiedKg.toKgString()).toBe('15000.000')
    expect(parent.capacityKesha.toNumber()).toBe(1600)
  })

  it('takes the TIGHTEST child safe-fill — a roll-up must not imply false headroom', () => {
    const parent = rollUp([
      figures({ safeFillPct: pct('0.950') }),
      figures({ safeFillPct: pct('0.800') }),
      figures({ safeFillPct: pct('0.900') }),
    ])
    expect(parent.safeFillPct.toString()).toBe('0.800')
  })

  it('returns an empty node for no children', () => {
    expect(rollUp([]).capacityKg.isZero()).toBe(true)
  })
})

describe('BestFitPlacementStrategy — proposes a plan, not a boolean', () => {
  const strategy = new BestFitPlacementStrategy()

  const location = (
    id: string,
    availableKg: number,
    availableKesha: number,
    customerLots = 0,
  ): CandidateLocation => ({
    locationId: id,
    label: `Section ${id}`,
    roomId: `room-${id}`,
    warehouseId: 'wh-1',
    existingCustomerLots: customerLots,
    figures: figures({
      capacityKg: Weight.fromWholeKg(availableKg),
      capacityKesha: ks(availableKesha),
    }),
  })

  it('places the whole consignment in one location when possible', () => {
    const proposal = strategy.propose({
      customerId: 'c1',
      request: { quantityKg: kg('30000'), keshaCount: ks(500) },
      candidates: [location('A', 50000, 1000), location('B', 100000, 2000)],
    })
    expect(proposal.satisfied).toBe(true)
    expect(proposal.lines).toHaveLength(1)
    // Best fit: the SMALLEST sufficient location, preserving large contiguous space.
    expect(proposal.lines[0]!.locationId).toBe('A')
  })

  it('prefers a location already holding this customer’s coffee', () => {
    const proposal = strategy.propose({
      customerId: 'c1',
      request: { quantityKg: kg('10000'), keshaCount: ks(200) },
      candidates: [location('A', 20000, 400), location('B', 50000, 1000, 3)],
    })
    expect(proposal.lines[0]!.locationId).toBe('B')
  })

  it('splits across locations when nothing takes it whole, largest first', () => {
    const proposal = strategy.propose({
      customerId: 'c1',
      request: { quantityKg: kg('60000'), keshaCount: ks(1200) },
      candidates: [location('A', 30000, 600), location('B', 40000, 800)],
    })
    expect(proposal.satisfied).toBe(true)
    expect(proposal.lines).toHaveLength(2)
    expect(proposal.lines[0]!.locationId).toBe('B')

    const totals = proposalTotals(proposal)
    expect(totals.quantityKg.toKgString()).toBe('60000.000')
    expect(totals.keshaCount.toNumber()).toBe(1200)
  })

  it('reports what it could NOT place, with a reason', () => {
    const proposal = strategy.propose({
      customerId: 'c1',
      request: { quantityKg: kg('100000'), keshaCount: ks(2000) },
      candidates: [location('A', 30000, 600)],
    })
    expect(proposal.satisfied).toBe(false)
    if (!proposal.satisfied) {
      expect(proposal.unplacedKg.toKgString()).toBe('70000.000')
      expect(proposal.reason).toMatch(/only part of the consignment/)
    }
  })

  it('refuses cleanly when no location has any space', () => {
    const proposal = strategy.propose({
      customerId: 'c1',
      request: { quantityKg: kg('1000'), keshaCount: ks(20) },
      candidates: [],
    })
    expect(proposal.satisfied).toBe(false)
    if (!proposal.satisfied) {
      expect(proposal.lines).toHaveLength(0)
      expect(proposal.reason).toMatch(/No storage location/)
    }
  })

  /** A proposal that over-commits a location would be worse than no proposal at all. */
  it('never proposes more than a location has available', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.array(fc.integer({ min: 1, max: 50_000 }), { minLength: 1, maxLength: 6 }),
        (requestKg, capacities) => {
          const candidates = capacities.map((c, i) => location(`L${i}`, c, c))
          const proposal = strategy.propose({
            customerId: 'c1',
            request: { quantityKg: Weight.fromWholeKg(requestKg), keshaCount: ks(requestKg) },
            candidates,
          })

          for (const line of proposal.lines) {
            const candidate = candidates.find((c) => c.locationId === line.locationId)!
            const available = computeAvailable(candidate.figures)
            expect(line.quantityKg.lessThanOrEqual(available.availableKg)).toBe(true)
            expect(line.keshaCount.lessThanOrEqual(available.availableKesha)).toBe(true)
          }
        },
      ),
    )
  })
})
