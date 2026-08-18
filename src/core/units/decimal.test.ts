import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { Decimal, DecimalError } from './decimal'

const WEIGHT_SCALE = 3
const MONEY_SCALE = 2

const kg = (s: string) => Decimal.parse(s, WEIGHT_SCALE)
const money = (s: string) => Decimal.parse(s, MONEY_SCALE)

describe('Decimal — construction', () => {
  it('parses exact decimal literals', () => {
    expect(kg('12.345').toString()).toBe('12.345')
    expect(kg('0').toString()).toBe('0.000')
    expect(kg('-7.5').toString()).toBe('-7.500')
    expect(kg('30000').toString()).toBe('30000.000')
  })

  it('preserves trailing-zero padding to the declared scale', () => {
    expect(kg('1.5').toString()).toBe('1.500')
    expect(money('10').toString()).toBe('10.00')
  })

  it('rejects excess precision rather than silently truncating a weight', () => {
    expect(() => kg('1.2345')).toThrow(DecimalError)
    expect(() => money('1.005')).toThrow(DecimalError)
  })

  it('accepts trailing zeros beyond scale (no significant loss)', () => {
    expect(kg('1.2340000').toString()).toBe('1.234')
  })

  it.each(['NaN', 'Infinity', '-Infinity', '1e5', '1.2e-3', '', 'abc', '1.2.3', '--1'])(
    'rejects %s — these indicate a float leaked in',
    (bad) => {
      expect(() => kg(bad)).toThrow(DecimalError)
    },
  )

  it('refuses to build from a fractional JS number', () => {
    expect(() => Decimal.fromInteger(1.5, WEIGHT_SCALE)).toThrow(/precision loss/)
  })

  it('accepts integers via fromInteger', () => {
    expect(Decimal.fromInteger(500, WEIGHT_SCALE).toString()).toBe('500.000')
  })
})

describe('Decimal — the float trap this type exists to prevent', () => {
  it('0.1 + 0.2 === 0.3 exactly', () => {
    expect(kg('0.1').add(kg('0.2')).equals(kg('0.3'))).toBe(true)
    // Demonstrating the bug we are avoiding:
    expect(0.1 + 0.2).not.toBe(0.3)
  })

  it('accumulates a thousand additions with no drift', () => {
    let acc = Decimal.zero(WEIGHT_SCALE)
    for (let i = 0; i < 1000; i++) acc = acc.add(kg('0.001'))
    expect(acc.toString()).toBe('1.000')
  })

  it('a realistic mass balance nets to exactly zero', () => {
    const input = kg('30000')
    const outputs = [kg('24150.5'), kg('3200.25'), kg('1450.125'), kg('900.075')]
    const loss = kg('299.05')
    const variance = input.subtract(Decimal.sum(outputs, WEIGHT_SCALE)).subtract(loss)
    expect(variance.isZero()).toBe(true)
  })
})

describe('Decimal — arithmetic properties', () => {
  const arbUnits = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n })
  const arbDec = arbUnits.map((u) => Decimal.fromUnits(u, WEIGHT_SCALE))

  it('addition is associative', () => {
    fc.assert(
      fc.property(arbDec, arbDec, arbDec, (a, b, c) => {
        expect(
          a
            .add(b)
            .add(c)
            .equals(a.add(b.add(c))),
        ).toBe(true)
      }),
    )
  })

  it('addition is commutative', () => {
    fc.assert(
      fc.property(arbDec, arbDec, (a, b) => {
        expect(a.add(b).equals(b.add(a))).toBe(true)
      }),
    )
  })

  it('subtract is the inverse of add', () => {
    fc.assert(
      fc.property(arbDec, arbDec, (a, b) => {
        expect(a.add(b).subtract(b).equals(a)).toBe(true)
      }),
    )
  })

  it('round-trips through its string form without loss', () => {
    fc.assert(
      fc.property(arbDec, (a) => {
        expect(Decimal.parse(a.toString(), WEIGHT_SCALE).equals(a)).toBe(true)
      }),
    )
  })

  it('negate is an involution', () => {
    fc.assert(
      fc.property(arbDec, (a) => {
        expect(a.negate().negate().equals(a)).toBe(true)
      }),
    )
  })
})

describe('Decimal — allocate (labour split, M18)', () => {
  it('splits exactly, distributing the remainder', () => {
    const shares = money('100.00').allocate(3)
    expect(shares.map((s) => s.toString())).toEqual(['33.34', '33.33', '33.33'])
    expect(Decimal.sum(shares, MONEY_SCALE).toString()).toBe('100.00')
  })

  it('always sums back to the original, for any amount and party count', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }),
        fc.integer({ min: 1, max: 40 }),
        (units, parts) => {
          const total = Decimal.fromUnits(units, MONEY_SCALE)
          const shares = total.allocate(parts)
          expect(shares).toHaveLength(parts)
          expect(Decimal.sum(shares, MONEY_SCALE).equals(total)).toBe(true)
        },
      ),
    )
  })

  it('rejects a non-positive party count', () => {
    expect(() => money('10.00').allocate(0)).toThrow(DecimalError)
    expect(() => money('10.00').allocate(-1)).toThrow(DecimalError)
  })
})

describe('Decimal — allocateByWeights (split by individual count, M18)', () => {
  it('allocates proportionally and sums exactly', () => {
    const shares = money('100.00').allocateByWeights([50, 30, 20])
    expect(Decimal.sum(shares, MONEY_SCALE).toString()).toBe('100.00')
    expect(shares[0]!.greaterThan(shares[1]!)).toBe(true)
  })

  it('sums exactly for arbitrary weights', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.array(fc.integer({ min: 1, max: 500 }), { minLength: 1, maxLength: 25 }),
        (units, weights) => {
          const total = Decimal.fromUnits(units, MONEY_SCALE)
          const shares = total.allocateByWeights(weights)
          expect(Decimal.sum(shares, MONEY_SCALE).equals(total)).toBe(true)
        },
      ),
    )
  })

  it('gives nothing to a zero-weight participant', () => {
    const shares = money('90.00').allocateByWeights([1, 0, 2])
    expect(shares[1]!.isZero()).toBe(true)
    expect(Decimal.sum(shares, MONEY_SCALE).toString()).toBe('90.00')
  })

  it('rejects weights summing to zero', () => {
    expect(() => money('10.00').allocateByWeights([0, 0])).toThrow(DecimalError)
  })
})

describe('Decimal — percentOf (yield and variance)', () => {
  it('computes a yield percentage', () => {
    // 24150 of 30000 = 80.500%
    expect(kg('24150').percentOf(kg('30000'), 3).toString()).toBe('80.500')
  })

  it('computes a small variance percentage', () => {
    expect(kg('15').percentOf(kg('30000'), 3).toString()).toBe('0.050')
  })

  it('refuses to divide by zero', () => {
    expect(() => kg('1').percentOf(kg('0'), 3)).toThrow(DecimalError)
  })

  it('yields across the four outputs plus loss sum to 100%', () => {
    const input = kg('30000')
    const parts = [kg('24150'), kg('3200'), kg('1450'), kg('900'), kg('300')]
    const total = parts.reduce((acc, p) => acc.add(p.percentOf(input, 3)), Decimal.zero(3))
    expect(total.toString()).toBe('100.000')
  })
})

describe('Decimal — scale discipline', () => {
  it('refuses to mix scales silently', () => {
    expect(() => kg('1').add(money('1') as unknown as Decimal)).toThrow(/different scale/)
  })

  it('widens exactly', () => {
    expect(money('1.23').rescale(4).toString()).toBe('1.2300')
  })

  it('narrows with HALF_UP by default', () => {
    expect(Decimal.parse('1.235', 3).rescale(2).toString()).toBe('1.24')
    expect(Decimal.parse('1.234', 3).rescale(2).toString()).toBe('1.23')
  })

  it('supports HALF_EVEN (banker’s rounding)', () => {
    expect(Decimal.parse('1.235', 3).rescale(2, 'HALF_EVEN').toString()).toBe('1.24')
    expect(Decimal.parse('1.225', 3).rescale(2, 'HALF_EVEN').toString()).toBe('1.22')
  })

  it('rounds negatives symmetrically', () => {
    expect(Decimal.parse('-1.235', 3).rescale(2).toString()).toBe('-1.24')
  })
})

describe('Decimal — comparison', () => {
  it('orders correctly', () => {
    expect(kg('1.001').greaterThan(kg('1'))).toBe(true)
    expect(kg('-1').lessThan(kg('0'))).toBe(true)
    expect(kg('5').greaterThanOrEqual(kg('5'))).toBe(true)
  })

  it('is consistent with arithmetic', () => {
    const arbDec = fc
      .bigInt({ min: -(10n ** 9n), max: 10n ** 9n })
      .map((u) => Decimal.fromUnits(u, WEIGHT_SCALE))
    fc.assert(
      fc.property(arbDec, arbDec, (a, b) => {
        const diff = a.subtract(b)
        if (a.greaterThan(b)) expect(diff.isPositive()).toBe(true)
        else if (a.lessThan(b)) expect(diff.isNegative()).toBe(true)
        else expect(diff.isZero()).toBe(true)
      }),
    )
  })
})
