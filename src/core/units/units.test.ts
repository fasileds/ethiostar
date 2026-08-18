import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { Weight } from './weight'
import { KeshaCount } from './kesha'
import { Money } from './money'
import { Decimal } from './decimal'
import {
  averageKgPerKesha,
  estimateWeightFromKesha,
  estimateKeshaFromWeight,
  checkAverageWeightOutlier,
  sumDual,
  addDual,
  subtractDual,
  dualQuantity,
  isDualZero,
} from './conversion'
import { WEIGHT_DECIMAL_PLACES, MONEY_DECIMAL_PLACES, PERCENT_DECIMAL_PLACES } from './scales'
import * as constants from '@config/constants'

describe('scales agree with the database column definitions', () => {
  it('matches @config/constants (kernel duplicates them deliberately)', () => {
    expect(WEIGHT_DECIMAL_PLACES).toBe(constants.WEIGHT_DECIMAL_PLACES)
    expect(MONEY_DECIMAL_PLACES).toBe(constants.MONEY_DECIMAL_PLACES)
    expect(PERCENT_DECIMAL_PLACES).toBe(constants.PERCENT_DECIMAL_PLACES)
  })
})

describe('Weight', () => {
  it('parses and renders to the gram', () => {
    expect(Weight.fromKg('30000.125').toKgString()).toBe('30000.125')
    expect(Weight.fromWholeKg(500).toKgString()).toBe('500.000')
    expect(Weight.fromGrams(1_500).toKgString()).toBe('1.500')
  })

  it('rejects sub-gram precision rather than truncating', () => {
    expect(() => Weight.fromKg('1.2345')).toThrow()
  })

  it('enforces positivity where the domain requires it', () => {
    expect(() => Weight.positiveFromKg('0', 'output weight')).toThrow(/greater than zero/)
    expect(() => Weight.nonNegativeFromKg('-1', 'receipt weight')).toThrow(/not be negative/)
    expect(Weight.positiveFromKg('0.001').toKgString()).toBe('0.001')
  })

  it('permits signed values for the stock ledger', () => {
    const out = Weight.fromKg('500').negate()
    expect(out.isNegative()).toBe(true)
    expect(out.toKgString()).toBe('-500.000')
  })

  it('sums a set of outputs exactly', () => {
    const outputs = ['24150.500', '3200.250', '1450.125', '900.075'].map(Weight.fromKg)
    expect(Weight.sum(outputs).toKgString()).toBe('29700.950')
  })

  it('computes yield as a percentage', () => {
    expect(Weight.fromKg('24150').percentOf(Weight.fromKg('30000')).toString()).toBe('80.500')
  })

  it('sum of signed movements over a closed job is exactly zero', () => {
    // The mass-balance invariant expressed as a ledger property (§3.4).
    // Note the sign of PROCESS_LOSS: loss is a DESTINATION, not a second withdrawal.
    // Stock leaves the input lot and arrives in the output lots and the loss account.
    // Recording loss as negative would double-count it against the issue.
    const movements = [
      Weight.fromKg('30000').negate(), // ISSUE_TO_JOB      −30000.000
      Weight.fromKg('24150.5'), // OUTPUT approved     +24150.500
      Weight.fromKg('3200.25'), // OUTPUT c-grade       +3200.250
      Weight.fromKg('1450.125'), // OUTPUT gravity       +1450.125
      Weight.fromKg('900.075'), // OUTPUT colour sorter  +900.075
      Weight.fromKg('299.05'), // PROCESS_LOSS           +299.050
    ]
    expect(Weight.sum(movements).isZero()).toBe(true)
  })

  it('detects an out-of-balance job', () => {
    const movements = [
      Weight.fromKg('30000').negate(),
      Weight.fromKg('29000'),
      Weight.fromKg('299.05'),
    ]
    const variance = Weight.sum(movements)
    expect(variance.isZero()).toBe(false)
    expect(variance.toKgString()).toBe('-700.950')
  })

  it('formats for display', () => {
    expect(Weight.fromKg('1234.5').format('en-US')).toBe('1,234.500 kg')
  })
})

describe('KeshaCount', () => {
  it('accepts only whole numbers', () => {
    expect(() => KeshaCount.from(1.5)).toThrow(/whole number/)
    expect(KeshaCount.from(500).toNumber()).toBe(500)
  })

  it('parses from the driver string form', () => {
    expect(KeshaCount.parse('403').toNumber()).toBe(403)
    expect(() => KeshaCount.parse('403.5')).toThrow()
    expect(() => KeshaCount.parse('abc')).toThrow()
  })

  it('enforces positivity where required', () => {
    expect(() => KeshaCount.positive(0, 'unloaded kesha')).toThrow(/greater than zero/)
    expect(() => KeshaCount.nonNegative(-1)).toThrow(/not be negative/)
  })

  it('adds and subtracts', () => {
    expect(KeshaCount.from(403).add(KeshaCount.from(54)).toNumber()).toBe(457)
    expect(KeshaCount.sum([1, 2, 3].map(KeshaCount.from)).toNumber()).toBe(6)
  })

  it('nets to zero over a bag reconciliation', () => {
    // in + issued = filled + returned + condemned  (M13 key control)
    const received = KeshaCount.from(500)
    const issued = KeshaCount.from(20)
    const filled = KeshaCount.from(497)
    const returned = KeshaCount.from(18)
    const condemned = KeshaCount.from(5)
    const variance = received
      .add(issued)
      .subtract(filled)
      .subtract(returned)
      .subtract(condemned)
    expect(variance.isZero()).toBe(true)
  })
})

describe('Money', () => {
  it('carries its currency', () => {
    expect(Money.parse('150.50').currency).toBe('ETB')
    expect(Money.parse('10.00', 'USD').toString()).toBe('10.00 USD')
  })

  it('refuses to mix currencies', () => {
    expect(() => Money.parse('1.00', 'ETB').add(Money.parse('1.00', 'USD'))).toThrow(
      /Cannot add ETB and USD/,
    )
  })

  it('rejects a malformed currency code', () => {
    expect(() => Money.parse('1.00', 'etb')).toThrow(/ISO 4217/)
    expect(() => Money.parse('1.00', 'BIRR')).toThrow(/ISO 4217/)
  })

  it('computes a piece-rate total', () => {
    // 403 kesha at 2.50 ETB
    const rate = Money.parse('2.50')
    expect(rate.timesCount(403).toAmountString()).toBe('1007.50')
  })

  it('applies an overtime multiplier', () => {
    const gross = Money.parse('1007.50')
    const multiplier = Decimal.parse('1.500', 3)
    expect(gross.timesRate(multiplier).toAmountString()).toBe('1511.25')
  })

  it('splits a gang payment with no lost cents', () => {
    const shares = Money.parse('1007.50').allocate(7)
    expect(Money.sum(shares).toAmountString()).toBe('1007.50')
    expect(shares).toHaveLength(7)
  })

  it('splits by individual count exactly, for any gang', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.array(fc.integer({ min: 1, max: 200 }), { minLength: 1, maxLength: 30 }),
        (minor, counts) => {
          const total = Money.fromMinorUnits(minor)
          const shares = total.allocateByWeights(counts)
          expect(Money.sum(shares).equals(total)).toBe(true)
        },
      ),
    )
  })
})

describe('kg ↔ kesha conversion (M11 dual-unit recording)', () => {
  it('computes the average weight per kesha shown on every receipt', () => {
    const avg = averageKgPerKesha(Weight.fromKg('30000'), KeshaCount.from(500))
    expect(avg?.toKgString()).toBe('60.000')
  })

  it('returns null rather than dividing by a zero count', () => {
    expect(averageKgPerKesha(Weight.fromKg('100'), KeshaCount.zero())).toBeNull()
  })

  it('estimates weight from a bag count for capacity planning', () => {
    const estimated = estimateWeightFromKesha(KeshaCount.from(500), Weight.fromKg('60'))
    expect(estimated.toKgString()).toBe('30000.000')
  })

  it('estimates a bag count from a weight, rounding up', () => {
    // A part-filled bag still occupies a whole bag's space.
    expect(
      estimateKeshaFromWeight(Weight.fromKg('30010'), Weight.fromKg('60')).toNumber(),
    ).toBe(501)
  })

  it('flags an average bag weight that diverges from the standard', () => {
    const threshold = Decimal.parse('5.000', 3) // 5%
    const ok = checkAverageWeightOutlier(
      Weight.fromKg('30000'),
      KeshaCount.from(500),
      Weight.fromKg('60'),
      threshold,
    )
    expect(ok.isOutlier).toBe(false)
    expect(ok.deviationPct?.toString()).toBe('0.000')

    // 500 bags averaging 50 kg against a 60 kg standard — 16.7% light.
    const bad = checkAverageWeightOutlier(
      Weight.fromKg('25000'),
      KeshaCount.from(500),
      Weight.fromKg('60'),
      threshold,
    )
    expect(bad.isOutlier).toBe(true)
    expect(bad.deviationPct?.isNegative()).toBe(true)
  })

  it('does not flag when the count is zero', () => {
    const r = checkAverageWeightOutlier(
      Weight.fromKg('100'),
      KeshaCount.zero(),
      Weight.fromKg('60'),
      Decimal.parse('5.000', 3),
    )
    expect(r.isOutlier).toBe(false)
    expect(r.deviationPct).toBeNull()
  })
})

describe('DualQuantity — every operational line records both units', () => {
  const q = (kg: string, kesha: number) =>
    dualQuantity(Weight.fromKg(kg), KeshaCount.from(kesha))

  it('adds and subtracts both units together', () => {
    const a = q('100', 2)
    const b = q('50.5', 1)
    expect(addDual(a, b).weight.toKgString()).toBe('150.500')
    expect(addDual(a, b).kesha.toNumber()).toBe(3)
    expect(subtractDual(a, b).weight.toKgString()).toBe('49.500')
  })

  it('sums a set of lines', () => {
    const total = sumDual([q('10', 1), q('20', 2), q('30', 3)])
    expect(total.weight.toKgString()).toBe('60.000')
    expect(total.kesha.toNumber()).toBe(6)
  })

  it('detects a zero net (used by transfer and job invariants)', () => {
    const out = q('500', 10)
    const inn = dualQuantity(out.weight.negate(), out.kesha.negate())
    expect(isDualZero(addDual(out, inn))).toBe(true)
  })
})
