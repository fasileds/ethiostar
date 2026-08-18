import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  validateMovement,
  assertTransferBalances,
  jobBalance,
  buildTransfer,
  balanceOf,
  assertSufficientStock,
  MOVEMENT_SIGN,
  MOVEMENT_TYPES,
  REASON_REQUIRED_TYPES,
  type StockMovement,
  type MovementType,
} from './movement'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

const kg = Weight.fromKg
const ks = KeshaCount.from

function movement(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    movementType: 'RECEIPT',
    occurredAt: new Date('2026-08-12T09:00:00Z'),
    lotId: 'lot-1',
    customerId: 'cust-1',
    consignmentId: 'cons-1',
    locationId: 'sec-1',
    quantityKg: kg('1000'),
    keshaCount: ks(20),
    bagTypeId: 'bag-1',
    reasonCodeId: null,
    sourceType: 'goods_receipt',
    sourceId: 'grn-1',
    actorId: 'user-1',
    witnessId: null,
    narrative: null,
    correlationId: 'corr-1',
    ...overrides,
  }
}

describe('movement sign conventions', () => {
  it('assigns a sign to every movement type', () => {
    for (const type of MOVEMENT_TYPES) {
      expect(MOVEMENT_SIGN[type]).toMatch(/^(POSITIVE|NEGATIVE|EITHER)$/)
    }
  })

  /**
   * A physical count that finds LESS than the ledger believed is the common case, not the
   * exception — constraining COUNT_VARIANCE to one sign would make an ordinary shortage
   * count fail validation.
   */
  it('COUNT_VARIANCE is EITHER — a count can find a shortage or an overage', () => {
    expect(MOVEMENT_SIGN.COUNT_VARIANCE).toBe('EITHER')
    expect(() =>
      validateMovement(
        movement({ movementType: 'COUNT_VARIANCE', quantityKg: kg('-5'), reasonCodeId: 'r-1' }),
      ),
    ).not.toThrow()
    expect(() =>
      validateMovement(
        movement({ movementType: 'COUNT_VARIANCE', quantityKg: kg('5'), reasonCodeId: 'r-1' }),
      ),
    ).not.toThrow()
  })

  /**
   * The detail that is easy to get wrong, and did get wrong in the first draft of the plan.
   * Loss is a DESTINATION, not a second withdrawal. Negative loss double-counts against the
   * issue and makes every job appear short by exactly the loss.
   */
  it('PROCESS_LOSS is POSITIVE — loss is a destination, not a second withdrawal', () => {
    expect(MOVEMENT_SIGN.PROCESS_LOSS).toBe('POSITIVE')
  })

  it('rejects a positive-type movement carrying a negative quantity', () => {
    expect(() =>
      validateMovement(movement({ movementType: 'RECEIPT', quantityKg: kg('-100') })),
    ).toThrow(BusinessRuleViolation)
  })

  it('rejects a negative-type movement carrying a positive quantity', () => {
    expect(() =>
      validateMovement(movement({ movementType: 'DISPATCH_OUT', quantityKg: kg('100') })),
    ).toThrow(BusinessRuleViolation)
  })

  it('accepts correctly-signed movements', () => {
    expect(() => validateMovement(movement({ movementType: 'RECEIPT' }))).not.toThrow()
    expect(() =>
      validateMovement(
        movement({
          movementType: 'DISPATCH_OUT',
          quantityKg: kg('-100'),
          keshaCount: ks(-2),
        }),
      ),
    ).not.toThrow()
  })
})

describe('the M12 control — unallocated stock is not permitted', () => {
  it('refuses a movement with no location', () => {
    try {
      validateMovement(movement({ locationId: '' }))
      expect.unreachable()
    } catch (error) {
      expect((error as BusinessRuleViolation).code).toBe(ERROR_CODES.LOCATION_REQUIRED)
    }
  })
})

describe('reason codes', () => {
  it.each(REASON_REQUIRED_TYPES)('requires a reason code for %s', (type) => {
    const signed =
      MOVEMENT_SIGN[type as MovementType] === 'NEGATIVE'
        ? { quantityKg: kg('-100'), keshaCount: ks(-2) }
        : {}
    expect(() =>
      validateMovement(movement({ movementType: type, reasonCodeId: null, ...signed })),
    ).toThrow(/requires a reason code/)
  })

  it('accepts an adjustment that carries one', () => {
    expect(() =>
      validateMovement(movement({ movementType: 'ADJUSTMENT_IN', reasonCodeId: 'reason-1' })),
    ).not.toThrow()
  })

  it('does not demand a reason code for ordinary operational movements', () => {
    expect(() => validateMovement(movement({ movementType: 'RECEIPT' }))).not.toThrow()
  })
})

describe('transfers net to exactly zero', () => {
  const transfer = () =>
    buildTransfer({
      from: 'sec-A',
      to: 'sec-B',
      quantityKg: kg('5000'),
      keshaCount: ks(100),
      lotId: 'lot-1',
      customerId: 'cust-1',
      consignmentId: 'cons-1',
      bagTypeId: 'bag-1',
      occurredAt: new Date('2026-08-12T09:00:00Z'),
      actorId: 'user-1',
      sourceId: 'transfer-1',
      correlationId: 'corr-1',
      narrative: null,
    })

  it('produces exactly two rows sharing one correlation id', () => {
    const pair = transfer()
    expect(pair).toHaveLength(2)
    expect(new Set(pair.map((m) => m.correlationId)).size).toBe(1)
    expect(pair.map((m) => m.movementType)).toEqual(['TRANSFER_OUT', 'TRANSFER_IN'])
  })

  it('nets to zero in both units', () => {
    const net = balanceOf(transfer())
    expect(net.quantityKg.isZero()).toBe(true)
    expect(net.keshaCount.isZero()).toBe(true)
  })

  it('moves the stock between the named locations', () => {
    const [out, into] = transfer()
    expect(out!.locationId).toBe('sec-A')
    expect(out!.quantityKg.isNegative()).toBe(true)
    expect(into!.locationId).toBe('sec-B')
    expect(into!.quantityKg.isPositive()).toBe(true)
  })

  it('rejects an unbalanced pair — stock is relocated, never created', () => {
    expect(() =>
      assertTransferBalances([
        movement({ movementType: 'TRANSFER_OUT', quantityKg: kg('-100'), keshaCount: ks(-2) }),
        movement({ movementType: 'TRANSFER_IN', quantityKg: kg('150'), keshaCount: ks(3) }),
      ]),
    ).toThrow(/must net to zero/)
  })

  it('refuses a negative transfer quantity', () => {
    expect(() =>
      buildTransfer({
        from: 'sec-A',
        to: 'sec-B',
        quantityKg: kg('-100'),
        keshaCount: ks(2),
        lotId: 'l',
        customerId: 'c',
        consignmentId: 'cn',
        bagTypeId: null,
        occurredAt: new Date('2026-08-12T09:00:00Z'),
        actorId: 'u',
        sourceId: 's',
        correlationId: 'co',
        narrative: null,
      }),
    ).toThrow(/must not be negative/)
  })

  it('nets to zero for any quantity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 20_000 }),
        (weight, bags) => {
          const pair = buildTransfer({
            from: 'A',
            to: 'B',
            quantityKg: Weight.fromWholeKg(weight),
            keshaCount: ks(bags),
            lotId: 'l',
            customerId: 'c',
            consignmentId: 'cn',
            bagTypeId: null,
            occurredAt: new Date('2026-08-12T09:00:00Z'),
            actorId: 'u',
            sourceId: 's',
            correlationId: 'co',
            narrative: null,
          })
          const net = balanceOf(pair)
          expect(net.quantityKg.isZero()).toBe(true)
          expect(net.keshaCount.isZero()).toBe(true)
        },
      ),
    )
  })
})

describe('jobBalance — the mass balance as a ledger property', () => {
  const jobMovements = (): StockMovement[] => [
    movement({ movementType: 'ISSUE_TO_JOB', quantityKg: kg('-30000'), keshaCount: ks(-500) }),
    movement({
      movementType: 'OUTPUT_FROM_JOB',
      quantityKg: kg('24150.5'),
      keshaCount: ks(403),
    }),
    movement({
      movementType: 'OUTPUT_FROM_JOB',
      quantityKg: kg('3200.25'),
      keshaCount: ks(54),
    }),
    movement({
      movementType: 'OUTPUT_FROM_JOB',
      quantityKg: kg('1450.125'),
      keshaCount: ks(25),
    }),
    movement({
      movementType: 'OUTPUT_FROM_JOB',
      quantityKg: kg('900.075'),
      keshaCount: ks(15),
    }),
    movement({
      movementType: 'PROCESS_LOSS',
      quantityKg: kg('299.05'),
      keshaCount: ks(3),
      reasonCodeId: 'loss-dust',
    }),
  ]

  it('balances exactly for a well-formed job', () => {
    const result = jobBalance(jobMovements())
    expect(result.balanced).toBe(true)
    expect(result.varianceKg.isZero()).toBe(true)
  })

  it('reports input, output and loss separately for the yield statement', () => {
    const result = jobBalance(jobMovements())
    expect(result.inputKg.toKgString()).toBe('30000.000')
    expect(result.outputKg.toKgString()).toBe('29700.950')
    expect(result.lossKg.toKgString()).toBe('299.050')
  })

  it('detects an out-of-balance job and reports the variance', () => {
    const short = jobMovements().slice(0, 3)
    const result = jobBalance(short)
    expect(result.balanced).toBe(false)
    expect(result.varianceKg.isNegative()).toBe(true)
  })

  it('balances for any output split, as long as the parts sum to the input', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 100_000 }),
        fc.integer({ min: 0, max: 999 }),
        (inputWhole, lossWhole) => {
          const input = Weight.fromWholeKg(inputWhole + lossWhole)
          const loss = Weight.fromWholeKg(lossWhole)
          const output = input.subtract(loss)

          const result = jobBalance([
            movement({ movementType: 'ISSUE_TO_JOB', quantityKg: input.negate() }),
            movement({ movementType: 'OUTPUT_FROM_JOB', quantityKg: output }),
            movement({
              movementType: 'PROCESS_LOSS',
              quantityKg: loss,
              reasonCodeId: 'r',
            }),
          ])

          expect(result.balanced).toBe(true)
          expect(result.inputKg.equals(input)).toBe(true)
        },
      ),
    )
  })
})

describe('assertSufficientStock — you cannot remove coffee that is not there', () => {
  it('permits a movement within the available balance', () => {
    expect(() =>
      assertSufficientStock(kg('1000'), ks(20), kg('500'), ks(10), 'Lot A'),
    ).not.toThrow()
  })

  it('permits an exact drawdown', () => {
    expect(() =>
      assertSufficientStock(kg('1000'), ks(20), kg('1000'), ks(20), 'Lot A'),
    ).not.toThrow()
  })

  it('refuses more weight than is held', () => {
    try {
      assertSufficientStock(kg('1000'), ks(20), kg('1500'), ks(10), 'Lot A')
      expect.unreachable()
    } catch (error) {
      const e = error as BusinessRuleViolation
      expect(e.code).toBe(ERROR_CODES.INSUFFICIENT_STOCK)
      expect(e.details).toMatchObject({ availableKg: '1000.000', requestedKg: '1500.000' })
    }
  })

  it('refuses more bags than are held, even when the weight fits', () => {
    expect(() => assertSufficientStock(kg('1000'), ks(20), kg('100'), ks(25), 'Lot A')).toThrow(
      BusinessRuleViolation,
    )
  })
})

describe('balanceOf — the projection is derived, never authored', () => {
  it('sums a realistic lot history', () => {
    const history = [
      movement({ movementType: 'RECEIPT', quantityKg: kg('30000'), keshaCount: ks(500) }),
      movement({ movementType: 'TRANSFER_OUT', quantityKg: kg('-5000'), keshaCount: ks(-83) }),
      movement({
        movementType: 'ISSUE_TO_JOB',
        quantityKg: kg('-10000'),
        keshaCount: ks(-167),
      }),
    ]
    const balance = balanceOf(history)
    expect(balance.quantityKg.toKgString()).toBe('15000.000')
    expect(balance.keshaCount.toNumber()).toBe(250)
  })

  it('returns zero for an empty history', () => {
    expect(balanceOf([]).quantityKg.isZero()).toBe(true)
  })

  /**
   * THE LEDGER INVARIANT: the projection equals the sum of the ledger, for any sequence of
   * operations. This is what lets stock_balance be dropped and rebuilt.
   */
  it('equals the sum of movements for any random operation sequence', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -50_000, max: 50_000 }), { minLength: 0, maxLength: 60 }),
        (deltas) => {
          const movements = deltas.map((delta) =>
            movement({
              movementType: delta >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
              quantityKg: Weight.fromWholeKg(delta),
              keshaCount: ks(delta >= 0 ? 1 : -1),
              reasonCodeId: 'r',
            }),
          )
          const expected = deltas.reduce((a, b) => a + b, 0)
          expect(balanceOf(movements).quantityKg.toKgString()).toBe(
            Weight.fromWholeKg(expected).toKgString(),
          )
        },
      ),
    )
  })
})
