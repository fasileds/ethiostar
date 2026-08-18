import { describe, it, expect } from 'vitest'
import {
  evaluateClearance,
  assertClearedForDispatch,
  assertGatePassUsable,
  checkGatePass,
  registrationsMatch,
  type ReleaseLot,
  type GatePass,
  type HoldReason,
} from './clearance'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

const acceptedLot = (overrides: Partial<ReleaseLot> = {}): ReleaseLot => ({
  lotId: 'lot-1',
  reference: 'LOT-2026-0001',
  status: 'ACCEPTED',
  hasSignedAcceptance: true,
  wasProcessed: true,
  ...overrides,
})

const clearanceInput = (overrides: Partial<Parameters<typeof evaluateClearance>[0]> = {}) => ({
  lots: [acceptedLot()],
  customerHolds: [] as HoldReason[],
  actorPermissions: new Set<string>(),
  overrideJustification: null,
  ...overrides,
})

describe('clearance — "No dispatch without customer acceptance recorded in M16"', () => {
  it('clears a properly accepted lot', () => {
    const result = evaluateClearance(clearanceInput())
    expect(result.cleared).toBe(true)
  })

  it('BLOCKS a processed lot with no signed Mirt Merekebiya', () => {
    const result = evaluateClearance(
      clearanceInput({
        lots: [acceptedLot({ hasSignedAcceptance: false, status: 'PRODUCED' })],
      }),
    )
    expect(result.cleared).toBe(false)
    if (!result.cleared) {
      expect(result.blockers[0]!.code).toBe(ERROR_CODES.NOT_ACCEPTED_BY_CUSTOMER)
      expect(result.blockers[0]!.message).toContain('LOT-2026-0001')
    }
  })

  /**
   * A customer withdrawing unprocessed coffee never passes M16, so acceptance does not
   * apply. See the STORED → RELEASE_REQUESTED route (open question 7).
   */
  it('clears an UNPROCESSED lot with no acceptance — withdrawal skips M16', () => {
    const result = evaluateClearance(
      clearanceInput({
        lots: [
          acceptedLot({ status: 'IN_STORE', wasProcessed: false, hasSignedAcceptance: false }),
        ],
      }),
    )
    expect(result.cleared).toBe(true)
  })

  it('blocks a lot already dispatched', () => {
    const result = evaluateClearance(
      clearanceInput({ lots: [acceptedLot({ status: 'DISPATCHED' })] }),
    )
    expect(result.cleared).toBe(false)
    if (!result.cleared)
      expect(result.blockers[0]!.message).toContain('already been dispatched')
  })

  it('blocks a lot consumed by processing', () => {
    const result = evaluateClearance(
      clearanceInput({ lots: [acceptedLot({ status: 'CONSUMED' })] }),
    )
    expect(result.cleared).toBe(false)
  })

  it('blocks a lot committed to a scheduled job', () => {
    const result = evaluateClearance(
      clearanceInput({ lots: [acceptedLot({ status: 'RESERVED_FOR_JOB' })] }),
    )
    expect(result.cleared).toBe(false)
    if (!result.cleared) {
      expect(result.blockers[0]!.code).toBe(ERROR_CODES.LOT_ALREADY_COMMITTED)
    }
  })

  /** One call to the customer, not three. */
  it('reports EVERY blocker rather than stopping at the first', () => {
    const result = evaluateClearance(
      clearanceInput({
        lots: [
          acceptedLot({ reference: 'LOT-A', hasSignedAcceptance: false, status: 'PRODUCED' }),
          acceptedLot({ lotId: 'lot-2', reference: 'LOT-B', status: 'DISPATCHED' }),
        ],
        customerHolds: [{ code: 'DOCUMENT_EXPIRED', message: 'Trade licence expired.' }],
      }),
    )
    expect(result.cleared).toBe(false)
    if (!result.cleared) expect(result.blockers).toHaveLength(3)
  })
})

describe('customer holds — the Phase 2 seam', () => {
  const documentHold: HoldReason = {
    code: 'DOCUMENT_EXPIRED',
    message: 'Trade licence expired on 1 August.',
  }

  const financialHold: HoldReason = {
    code: 'CREDIT_LIMIT',
    message: 'Outstanding balance beyond terms.',
    overridableBy: 'dispatch:override_hold',
  }

  it('blocks on a non-overridable hold', () => {
    const result = evaluateClearance(clearanceInput({ customerHolds: [documentHold] }))
    expect(result.cleared).toBe(false)
  })

  it('blocks an overridable hold when the actor lacks the permission', () => {
    const result = evaluateClearance(
      clearanceInput({
        customerHolds: [financialHold],
        overrideJustification: 'Finance manager approved by phone this morning.',
      }),
    )
    expect(result.cleared).toBe(false)
  })

  it('blocks an overridable hold when no justification is given', () => {
    const result = evaluateClearance(
      clearanceInput({
        customerHolds: [financialHold],
        actorPermissions: new Set(['dispatch:override_hold']),
        overrideJustification: null,
      }),
    )
    expect(result.cleared).toBe(false)
  })

  it('permits an override with the permission AND a written justification, and records it', () => {
    const result = evaluateClearance(
      clearanceInput({
        customerHolds: [financialHold],
        actorPermissions: new Set(['dispatch:override_hold']),
        overrideJustification: 'Finance manager approved release against a signed undertaking.',
      }),
    )
    expect(result.cleared).toBe(true)
    if (result.cleared) {
      // The override is RECORDED, not silent — it appears on the exception register.
      expect(result.overriddenHolds).toEqual([financialHold])
    }
  })
})

describe('assertClearedForDispatch', () => {
  it('returns overridden holds when cleared', () => {
    expect(assertClearedForDispatch(clearanceInput())).toEqual([])
  })

  it('throws with every blocker listed', () => {
    try {
      assertClearedForDispatch(
        clearanceInput({
          lots: [acceptedLot({ hasSignedAcceptance: false, status: 'PRODUCED' })],
        }),
      )
      expect.unreachable()
    } catch (error) {
      const e = error as BusinessRuleViolation
      expect(e.code).toBe(ERROR_CODES.CLEARANCE_FAILED)
      expect(Array.isArray(e.details?.blockers)).toBe(true)
    }
  })
})

describe('gate pass — "No vehicle leaves without a valid, unused pass"', () => {
  const pass = (overrides: Partial<GatePass> = {}): GatePass => ({
    id: 'gp-1',
    number: 'GP-2026-000123',
    status: 'ISSUED',
    vehicleRegistration: 'AA-12345',
    driverName: 'Abebe Bekele',
    issuedAt: new Date('2026-08-13T06:00:00Z'),
    expiresAt: new Date('2026-08-13T18:00:00Z'),
    usedAt: null,
    ...overrides,
  })

  const attempt = (p: GatePass, plate = 'AA-12345', at = '2026-08-13T10:00:00Z') => ({
    pass: p,
    presentedVehicleRegistration: plate,
    at: new Date(at),
  })

  it('permits a valid, unused pass on the right vehicle', () => {
    expect(() => assertGatePassUsable(attempt(pass()))).not.toThrow()
  })

  /** Single use. Two officers scanning the same pass must produce exactly one gate-out. */
  it('REFUSES a pass that has already been used', () => {
    try {
      assertGatePassUsable(
        attempt(pass({ status: 'USED', usedAt: new Date('2026-08-13T09:00:00Z') })),
      )
      expect.unreachable()
    } catch (error) {
      expect((error as BusinessRuleViolation).code).toBe(ERROR_CODES.GATE_PASS_ALREADY_USED)
    }
  })

  it('refuses a cancelled pass', () => {
    expect(() => assertGatePassUsable(attempt(pass({ status: 'CANCELLED' })))).toThrow(
      BusinessRuleViolation,
    )
  })

  it('refuses an expired pass', () => {
    try {
      assertGatePassUsable(attempt(pass(), 'AA-12345', '2026-08-13T19:00:00Z'))
      expect.unreachable()
    } catch (error) {
      expect((error as BusinessRuleViolation).code).toBe(ERROR_CODES.GATE_PASS_EXPIRED)
    }
  })

  it('refuses a pass presented on a different vehicle', () => {
    try {
      assertGatePassUsable(attempt(pass(), 'BB-99999'))
      expect.unreachable()
    } catch (error) {
      const e = error as BusinessRuleViolation
      expect(e.code).toBe(ERROR_CODES.GATE_PASS_VEHICLE_MISMATCH)
      expect(e.details).toMatchObject({
        expectedVehicle: 'AA-12345',
        presentedVehicle: 'BB-99999',
      })
    }
  })

  it('checkGatePass returns a red/green result for the gate screen', () => {
    expect(checkGatePass(attempt(pass()))).toEqual({ valid: true, reason: null })

    const bad = checkGatePass(attempt(pass({ status: 'USED' })))
    expect(bad.valid).toBe(false)
    expect(bad.reason).toContain('already been used')
  })
})

describe('registrationsMatch — a gate officer at night should not be defeated by a hyphen', () => {
  it.each([
    ['AA-12345', 'AA 12345'],
    ['AA-12345', 'aa12345'],
    ['AA 12345', 'AA-12345'],
    ['  AA-12345  ', 'AA12345'],
  ])('treats %s and %s as the same vehicle', (a, b) => {
    expect(registrationsMatch(a, b)).toBe(true)
  })

  it.each([
    ['AA-12345', 'AA-12346'],
    ['AA-12345', 'BB-12345'],
    ['AA-12345', ''],
    ['', ''],
  ])('treats %s and %s as different', (a, b) => {
    expect(registrationsMatch(a, b)).toBe(false)
  })
})
