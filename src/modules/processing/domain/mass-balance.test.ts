import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  computeMassBalance,
  assertMayClose,
  varianceStatus,
  detectYieldOutliers,
  toYieldSnapshot,
  type OutputLine,
  type MassBalanceInput,
} from './mass-balance'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { Decimal } from '@core/units/decimal'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { OUTPUT_CLASSIFICATION_CODES } from '@config/constants'

const kg = Weight.fromKg
const ks = KeshaCount.from
const pct = (v: string) => Decimal.parse(v, 3)

const output = (code: string, quantity: string, bags: number): OutputLine => ({
  classificationCode: code,
  quantityKg: kg(quantity),
  keshaCount: ks(bags),
  bagTypeId: 'bag-1',
  locationId: 'sec-1',
})

/** A realistic, perfectly balanced job: 30,000 kg in, four outputs plus loss. */
function balancedJob(): MassBalanceInput {
  return {
    inputKg: kg('30000'),
    outputs: [
      output(OUTPUT_CLASSIFICATION_CODES.APPROVED, '24150.500', 403),
      output(OUTPUT_CLASSIFICATION_CODES.C_GRADE, '3200.250', 54),
      output(OUTPUT_CLASSIFICATION_CODES.GRAVITY, '1450.125', 25),
      output(OUTPUT_CLASSIFICATION_CODES.COLOUR_SORTER, '900.075', 15),
    ],
    losses: [{ reasonCodeId: 'loss-dust', quantityKg: kg('299.050') }],
    tolerancePct: pct('0.500'),
  }
}

describe('computeMassBalance', () => {
  it('balances exactly: input = outputs + loss', () => {
    const result = computeMassBalance(balancedJob())
    expect(result.varianceKg.isZero()).toBe(true)
    expect(result.withinTolerance).toBe(true)
    expect(result.outputKg.toKgString()).toBe('29700.950')
    expect(result.lossKg.toKgString()).toBe('299.050')
  })

  it('computes a yield percentage for each of the four outputs', () => {
    const result = computeMassBalance(balancedJob())
    expect(result.yields).toHaveLength(4)

    const approved = result.yields.find(
      (y) => y.classificationCode === OUTPUT_CLASSIFICATION_CODES.APPROVED,
    )
    expect(approved?.yieldPct.toString()).toBe('80.502')
  })

  /**
   * Yields are DISPLAY figures, each rounded independently to 3dp, so they need not sum to
   * exactly 100% — here they sum to 100.001%. That is correct, not a bug: the authoritative
   * check is the mass balance in KILOGRAMS, which is exact.
   *
   * This matters for the yield statement: never present the rounded percentages as if they
   * reconcile, and never derive a weight back from one.
   */
  it('yields plus loss sum to ~100%, within independent-rounding error', () => {
    const result = computeMassBalance(balancedJob())
    const total = result.yields
      .reduce((acc, y) => acc.add(y.yieldPct), Decimal.zero(3))
      .add(result.lossPct)

    const drift = total.subtract(Decimal.parse('100.000', 3)).abs()
    // At most one unit in the last place per rounded line (4 outputs + loss).
    expect(drift.lessThanOrEqual(Decimal.parse('0.005', 3))).toBe(true)

    // The KILOGRAM balance, by contrast, is exact.
    expect(result.varianceKg.isZero()).toBe(true)
  })

  it('detects a short job and reports the variance', () => {
    const short: MassBalanceInput = {
      ...balancedJob(),
      losses: [{ reasonCodeId: 'loss-dust', quantityKg: kg('100') }],
    }
    const result = computeMassBalance(short)
    expect(result.varianceKg.toKgString()).toBe('199.050')
    expect(result.varianceKg.isPositive()).toBe(true) // SHORT
    expect(result.withinTolerance).toBe(false)
  })

  it('detects an over-recorded job', () => {
    const over: MassBalanceInput = {
      ...balancedJob(),
      losses: [{ reasonCodeId: 'loss-dust', quantityKg: kg('500') }],
    }
    const result = computeMassBalance(over)
    expect(result.varianceKg.isNegative()).toBe(true) // OVER
  })

  it('accepts a variance within tolerance', () => {
    // 30 kg on 30,000 kg = 0.100%, inside the 0.500% tolerance.
    const slight: MassBalanceInput = {
      ...balancedJob(),
      losses: [{ reasonCodeId: 'loss-dust', quantityKg: kg('269.050') }],
    }
    const result = computeMassBalance(slight)
    expect(result.variancePct.toString()).toBe('0.100')
    expect(result.withinTolerance).toBe(true)
  })

  it('honours a per-coffee-type tolerance', () => {
    // A natural sun-dried lot is allowed more drift than a washed one.
    const naturalTolerance: MassBalanceInput = {
      ...balancedJob(),
      losses: [{ reasonCodeId: 'loss-dust', quantityKg: kg('99.05') }],
      tolerancePct: pct('0.800'),
    }
    expect(computeMassBalance(naturalTolerance).withinTolerance).toBe(true)

    const washedTolerance = { ...naturalTolerance, tolerancePct: pct('0.500') }
    expect(computeMassBalance(washedTolerance).withinTolerance).toBe(false)
  })

  it('refuses to compute a balance for a zero input', () => {
    expect(() => computeMassBalance({ ...balancedJob(), inputKg: Weight.zero() })).toThrow(
      BusinessRuleViolation,
    )
  })

  it('balances for any split of input into outputs and loss', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 200_000 }),
        fc.integer({ min: 0, max: 5_000 }),
        (outputWhole, lossWhole) => {
          const result = computeMassBalance({
            inputKg: Weight.fromWholeKg(outputWhole + lossWhole),
            outputs: [output('APPROVED', String(outputWhole), 1)],
            losses: [{ reasonCodeId: 'r', quantityKg: Weight.fromWholeKg(lossWhole) }],
            tolerancePct: pct('0.500'),
          })
          expect(result.varianceKg.isZero()).toBe(true)
          expect(result.withinTolerance).toBe(true)
        },
      ),
    )
  })
})

describe('assertMayClose — THE M15 KEY CONTROL', () => {
  const balance = (input: MassBalanceInput) => computeMassBalance(input)

  it('closes a job that is within tolerance', () => {
    expect(() =>
      assertMayClose({
        balance: balance(balancedJob()),
        varianceExplanation: null,
        varianceReasonCodeId: null,
        mayCloseWithVariance: false,
      }),
    ).not.toThrow()
  })

  it('REFUSES a job outside tolerance and unexplained', () => {
    const outOfTolerance = balance({
      ...balancedJob(),
      losses: [{ reasonCodeId: 'r', quantityKg: kg('100') }],
    })

    try {
      assertMayClose({
        balance: outOfTolerance,
        varianceExplanation: null,
        varianceReasonCodeId: null,
        mayCloseWithVariance: false,
      })
      expect.unreachable('a job outside tolerance must not close')
    } catch (error) {
      const e = error as BusinessRuleViolation
      expect(e.code).toBe(ERROR_CODES.MASS_BALANCE_OUT_OF_TOLERANCE)
      expect(e.details).toMatchObject({ direction: 'SHORT', variancePct: '0.664' })
    }
  })

  /**
   * `job_order:close_with_variance` is a DIFFERENT permission from `job_order:close`.
   * That separation is what makes the exception report meaningful.
   */
  it('refuses even with an explanation when the actor lacks the higher permission', () => {
    const outOfTolerance = balance({
      ...balancedJob(),
      losses: [{ reasonCodeId: 'r', quantityKg: kg('100') }],
    })

    expect(() =>
      assertMayClose({
        balance: outOfTolerance,
        varianceExplanation: 'Scale drift confirmed by recalibration on 12 August.',
        varianceReasonCodeId: 'MB_SCALE_DRIFT',
        mayCloseWithVariance: false,
      }),
    ).toThrow(/requires authorisation/)
  })

  it('closes outside tolerance WITH a reason code, a written note and the permission', () => {
    const outOfTolerance = balance({
      ...balancedJob(),
      losses: [{ reasonCodeId: 'r', quantityKg: kg('100') }],
    })

    expect(() =>
      assertMayClose({
        balance: outOfTolerance,
        varianceExplanation: 'Scale drift confirmed by recalibration on 12 August.',
        varianceReasonCodeId: 'MB_SCALE_DRIFT',
        mayCloseWithVariance: true,
      }),
    ).not.toThrow()
  })

  it('rejects a token explanation', () => {
    const outOfTolerance = balance({
      ...balancedJob(),
      losses: [{ reasonCodeId: 'r', quantityKg: kg('100') }],
    })

    expect(() =>
      assertMayClose({
        balance: outOfTolerance,
        varianceExplanation: 'ok',
        varianceReasonCodeId: 'MB_SCALE_DRIFT',
        mayCloseWithVariance: true,
      }),
    ).toThrowError(expect.objectContaining({ code: ERROR_CODES.VARIANCE_EXPLANATION_REQUIRED }))
  })

  it('rejects an explanation with no reason code — the exception register needs the code', () => {
    const outOfTolerance = balance({
      ...balancedJob(),
      losses: [{ reasonCodeId: 'r', quantityKg: kg('100') }],
    })

    expect(() =>
      assertMayClose({
        balance: outOfTolerance,
        varianceExplanation: 'A long enough explanation of what happened here.',
        varianceReasonCodeId: null,
        mayCloseWithVariance: true,
      }),
    ).toThrowError(expect.objectContaining({ code: ERROR_CODES.VARIANCE_EXPLANATION_REQUIRED }))
  })

  it('refuses to close a job with no outputs recorded at all', () => {
    expect(() =>
      assertMayClose({
        balance: computeMassBalance({
          inputKg: kg('30000'),
          outputs: [],
          losses: [],
          tolerancePct: pct('0.500'),
        }),
        varianceExplanation: null,
        varianceReasonCodeId: null,
        mayCloseWithVariance: true,
      }),
    ).toThrowError(expect.objectContaining({ code: ERROR_CODES.NO_OUTPUTS_RECORDED }))
  })
})

describe('varianceStatus — the live display during job execution', () => {
  it('reports BALANCED, WITHIN_TOLERANCE and OUT_OF_TOLERANCE', () => {
    expect(varianceStatus(computeMassBalance(balancedJob()))).toBe('BALANCED')

    expect(
      varianceStatus(
        computeMassBalance({
          ...balancedJob(),
          losses: [{ reasonCodeId: 'r', quantityKg: kg('269.050') }],
        }),
      ),
    ).toBe('WITHIN_TOLERANCE')

    expect(
      varianceStatus(
        computeMassBalance({
          ...balancedJob(),
          losses: [{ reasonCodeId: 'r', quantityKg: kg('100') }],
        }),
      ),
    ).toBe('OUT_OF_TOLERANCE')
  })
})

describe('detectYieldOutliers — balanced but abnormal', () => {
  const expected = new Map([
    [OUTPUT_CLASSIFICATION_CODES.APPROVED, pct('80.000')],
    [OUTPUT_CLASSIFICATION_CODES.C_GRADE, pct('11.000')],
  ])

  it('passes a job whose yields match expectations', () => {
    const result = computeMassBalance(balancedJob())
    expect(detectYieldOutliers(result.yields, expected, pct('5.000'))).toEqual([])
  })

  /**
   * A job can be PERFECTLY balanced and still be wrong: 90% approved on a lot that
   * normally yields 80% means an output was misclassified. This is the fixed-threshold
   * version of what M27 (Phase 3) learns to detect.
   */
  it('flags an output whose yield diverges materially, even on a balanced job', () => {
    const skewed = computeMassBalance({
      inputKg: kg('30000'),
      outputs: [
        output(OUTPUT_CLASSIFICATION_CODES.APPROVED, '27000', 450),
        output(OUTPUT_CLASSIFICATION_CODES.C_GRADE, '2700', 45),
      ],
      losses: [{ reasonCodeId: 'r', quantityKg: kg('300') }],
      tolerancePct: pct('0.500'),
    })

    expect(skewed.varianceKg.isZero()).toBe(true) // perfectly balanced
    const outliers = detectYieldOutliers(skewed.yields, expected, pct('5.000'))
    expect(outliers.map((o) => o.classificationCode)).toContain(
      OUTPUT_CLASSIFICATION_CODES.APPROVED,
    )
  })

  it('ignores classifications with no expected share configured', () => {
    const result = computeMassBalance(balancedJob())
    expect(detectYieldOutliers(result.yields, new Map(), pct('1.000'))).toEqual([])
  })
})

describe('toYieldSnapshot — stored at close so master-data edits cannot rewrite history', () => {
  it('captures every figure as an exact string', () => {
    const snapshot = toYieldSnapshot(computeMassBalance(balancedJob()))
    expect(snapshot.inputKg).toBe('30000.000')
    expect(snapshot.varianceKg).toBe('0.000')
    expect(snapshot.withinTolerance).toBe(true)
    expect(snapshot.lines).toHaveLength(4)
    expect(snapshot.lines[0]).toMatchObject({
      classificationCode: OUTPUT_CLASSIFICATION_CODES.APPROVED,
      quantityKg: '24150.500',
      keshaCount: 403,
    })
  })

  it('is JSON-serialisable with no precision loss', () => {
    const snapshot = toYieldSnapshot(computeMassBalance(balancedJob()))
    const round = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot
    expect(round.lines[0]!.quantityKg).toBe('24150.500')
  })
})
