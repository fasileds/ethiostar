import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calculateEarnings,
  assertCorrectionIsValid,
  voucherTotal,
  type EarningsInput,
  type PieceRateVersion,
} from './piece-rate'
import { Money } from '@core/units/money'
import { KeshaCount } from '@core/units/kesha'
import { Decimal } from '@core/units/decimal'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

const ks = KeshaCount.from
const mult = (v: string) => Decimal.parse(v, 3)

const rate: PieceRateVersion = {
  id: 'rate-v1',
  amountPerKesha: Money.parse('2.50'),
  overtimeMultiplier: mult('1.500'),
  nightMultiplier: mult('1.250'),
  holidayMultiplier: mult('2.000'),
}

function input(overrides: Partial<EarningsInput> = {}): EarningsInput {
  return {
    confirmedKeshaCount: ks(500),
    rate,
    members: [
      { workerId: 'w1', individualCount: 0 },
      { workerId: 'w2', individualCount: 0 },
      { workerId: 'w3', individualCount: 0 },
    ],
    splitMethod: 'EQUAL',
    isOvertime: false,
    isNightShift: false,
    isHoliday: false,
    ...overrides,
  }
}

describe('calculateEarnings — the M18 key control', () => {
  /**
   * "Labour payment is always calculated from the store keeper's confirmed kesha count —
   * there is no independent quantity entry for payroll purposes."
   */
  it('computes gross as confirmed count × rate', () => {
    const result = calculateEarnings(input())
    expect(result.confirmedKeshaCount.toNumber()).toBe(500)
    expect(result.baseAmount.toAmountString()).toBe('1250.00')
    expect(result.grossAmount.toAmountString()).toBe('1250.00')
  })

  it('records the rate VERSION used, so an old voucher reproduces exactly', () => {
    expect(calculateEarnings(input()).pieceRateVersionId).toBe('rate-v1')
  })

  it('applies the overtime multiplier', () => {
    const result = calculateEarnings(input({ isOvertime: true }))
    expect(result.appliedMultiplier.toString()).toBe('1.500')
    expect(result.grossAmount.toAmountString()).toBe('1875.00')
  })

  it('applies the night multiplier', () => {
    expect(calculateEarnings(input({ isNightShift: true })).grossAmount.toAmountString()).toBe(
      '1562.50',
    )
  })

  it('applies the holiday multiplier', () => {
    expect(calculateEarnings(input({ isHoliday: true })).grossAmount.toAmountString()).toBe(
      '2500.00',
    )
  })

  /**
   * ⚠️ CONFIRM — open question 5 covers both the multiplier VALUES and whether they
   * compound or the highest applies. Compounding is implemented; a plant that pays only
   * the largest premium will be corrected by its workforce.
   */
  it('COMPOUNDS multiple premiums', () => {
    const result = calculateEarnings(
      input({ isOvertime: true, isNightShift: true, isHoliday: true }),
    )
    // 1.5 × 1.25 × 2.0 = 3.75
    expect(result.appliedMultiplier.toString()).toBe('3.750')
    expect(result.grossAmount.toAmountString()).toBe('4687.50')
  })

  it('refuses a gang with no members', () => {
    try {
      calculateEarnings(input({ members: [] }))
      expect.unreachable()
    } catch (error) {
      expect((error as BusinessRuleViolation).code).toBe(ERROR_CODES.GANG_HAS_NO_MEMBERS)
    }
  })

  it('handles a zero count without dividing by zero', () => {
    const result = calculateEarnings(input({ confirmedKeshaCount: ks(0) }))
    expect(result.grossAmount.isZero()).toBe(true)
    expect(result.perWorker).toHaveLength(3)
  })
})

describe('EQUAL split', () => {
  it('splits so the shares sum EXACTLY to the gross — no cents lost', () => {
    // 1250.00 / 3 does not divide evenly.
    const result = calculateEarnings(input())
    expect(result.perWorker.map((w) => w.share.toAmountString())).toEqual([
      '416.67',
      '416.67',
      '416.66',
    ])
    expect(Money.sum(result.perWorker.map((w) => w.share)).toAmountString()).toBe('1250.00')
  })

  it('attributes the bag count across the gang, summing to the confirmed total', () => {
    const result = calculateEarnings(input())
    expect(result.perWorker.map((w) => w.attributedCount)).toEqual([167, 167, 166])
    expect(result.perWorker.reduce((a, w) => a + w.attributedCount, 0)).toBe(500)
  })

  it('sums exactly for any count and gang size', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000 }),
        fc.integer({ min: 1, max: 30 }),
        (count, gangSize) => {
          const result = calculateEarnings(
            input({
              confirmedKeshaCount: ks(count),
              members: Array.from({ length: gangSize }, (_, i) => ({
                workerId: `w${i}`,
                individualCount: 0,
              })),
            }),
          )
          expect(
            Money.sum(result.perWorker.map((w) => w.share)).equals(result.grossAmount),
          ).toBe(true)
          expect(result.perWorker.reduce((a, w) => a + w.attributedCount, 0)).toBe(count)
        },
      ),
    )
  })
})

describe('BY_INDIVIDUAL_COUNT split', () => {
  const byCount = (counts: number[]) =>
    input({
      splitMethod: 'BY_INDIVIDUAL_COUNT',
      confirmedKeshaCount: ks(counts.reduce((a, b) => a + b, 0)),
      members: counts.map((c, i) => ({ workerId: `w${i + 1}`, individualCount: c })),
    })

  it('splits proportionally to each worker’s count', () => {
    const result = calculateEarnings(byCount([250, 150, 100]))
    expect(result.grossAmount.toAmountString()).toBe('1250.00')
    expect(result.perWorker.map((w) => w.share.toAmountString())).toEqual([
      '625.00',
      '375.00',
      '250.00',
    ])
  })

  /**
   * The individual counts ARE the confirmed count, broken down. If they disagree, one of
   * the two was entered independently — precisely what the key control forbids.
   */
  it('REFUSES when the individual counts do not sum to the confirmed count', () => {
    const mismatched = input({
      splitMethod: 'BY_INDIVIDUAL_COUNT',
      confirmedKeshaCount: ks(500),
      members: [
        { workerId: 'w1', individualCount: 250 },
        { workerId: 'w2', individualCount: 200 }, // 450, not 500
      ],
    })

    try {
      calculateEarnings(mismatched)
      expect.unreachable('a parallel tally sheet must be refused')
    } catch (error) {
      const e = error as BusinessRuleViolation
      expect(e.code).toBe(ERROR_CODES.LABOUR_QUANTITY_NOT_DERIVED)
      expect(e.details).toMatchObject({ confirmedKeshaCount: 500, sumOfIndividualCounts: 450 })
    }
  })

  it('refuses when no worker has a recorded count', () => {
    expect(() =>
      calculateEarnings(
        input({
          splitMethod: 'BY_INDIVIDUAL_COUNT',
          confirmedKeshaCount: ks(0),
          members: [{ workerId: 'w1', individualCount: 0 }],
        }),
      ),
    ).toThrow(BusinessRuleViolation)
  })

  it('sums exactly for any distribution', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 500 }), { minLength: 1, maxLength: 20 }),
        (counts) => {
          const result = calculateEarnings(byCount(counts))
          expect(
            Money.sum(result.perWorker.map((w) => w.share)).equals(result.grossAmount),
          ).toBe(true)
        },
      ),
    )
  })
})

describe('corrections never edit an existing activity', () => {
  it('requires a reason code and an explanation', () => {
    expect(() =>
      assertCorrectionIsValid({
        originalActivityId: 'a1',
        deltaKeshaCount: ks(-10),
        reasonCodeId: '',
        narrative: 'typo',
      }),
    ).toThrow(BusinessRuleViolation)
  })

  it('rejects a no-op correction', () => {
    expect(() =>
      assertCorrectionIsValid({
        originalActivityId: 'a1',
        deltaKeshaCount: ks(0),
        reasonCodeId: 'ADJ_DATA_CORRECTION',
        narrative: 'A sufficiently detailed explanation.',
      }),
    ).toThrow(BusinessRuleViolation)
  })

  it('accepts a properly documented correction', () => {
    expect(() =>
      assertCorrectionIsValid({
        originalActivityId: 'a1',
        deltaKeshaCount: ks(-10),
        reasonCodeId: 'ADJ_DATA_CORRECTION',
        narrative: 'Ten bags double-counted at the bay; GRN corrected the same day.',
      }),
    ).not.toThrow()
  })
})

describe('voucherTotal', () => {
  it('sums several activities into the voucher figure', () => {
    const unloading = calculateEarnings(input())
    const loading = calculateEarnings(input({ confirmedKeshaCount: ks(403) }))
    expect(voucherTotal([unloading, loading]).toAmountString()).toBe('2257.50')
  })

  it('is zero for no activities', () => {
    expect(voucherTotal([]).isZero()).toBe(true)
  })
})
