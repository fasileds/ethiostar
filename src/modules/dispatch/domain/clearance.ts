import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import type { LotStatus } from '@modules/consignment'

/**
 * M17 — dispatch clearance and the gate pass.
 *
 * Two key controls, both verbatim:
 *   • "No dispatch without customer acceptance recorded in M16."
 *   • "No vehicle leaves without a valid, unused pass."
 *
 * "the customer requests release, EthioStar confirms it is clear to go, the truck is loaded
 * and the coffee leaves under a gate pass with stock deducted at the moment of departure."
 */

// ── Clearance ────────────────────────────────────────────────────────────────

export interface ReleaseLot {
  readonly lotId: string
  readonly reference: string
  readonly status: LotStatus
  /**
   * Whether this lot is covered by a signed Mirt Merekebiya.
   * A lot released straight from store without processing has none — see the STORED →
   * RELEASE_REQUESTED route in the consignment lifecycle (open question 7).
   */
  readonly hasSignedAcceptance: boolean
  /** True when the lot never entered processing, so acceptance does not apply. */
  readonly wasProcessed: boolean
}

export interface HoldReason {
  readonly code: string
  readonly message: string
  /** The permission that may override this hold, if any. */
  readonly overridableBy?: string | undefined
}

export interface ClearanceInput {
  readonly lots: readonly ReleaseLot[]
  /**
   * From `CustomerHoldPolicy`. Phase 1 supplies document-compliance and manual holds;
   * Phase 2's M19 adds the financial hold as a second policy with no change here.
   * docs/architecture/07-extension-points.md Seam 4.
   */
  readonly customerHolds: readonly HoldReason[]
  /** Permissions the acting user holds, for evaluating overridable holds. */
  readonly actorPermissions: ReadonlySet<string>
  readonly overrideJustification: string | null
}

export type ClearanceResult =
  | { readonly cleared: true; readonly overriddenHolds: readonly HoldReason[] }
  | { readonly cleared: false; readonly blockers: readonly HoldReason[] }

/**
 * Is this release clear to go?
 *
 * Evaluates ALL blockers rather than short-circuiting on the first, so the officer can tell
 * the customer everything that is wrong in one call instead of three.
 */
export function evaluateClearance(input: ClearanceInput): ClearanceResult {
  const blockers: HoldReason[] = []
  const overridden: HoldReason[] = []

  // 1. Acceptance (M16). A processed lot may not leave without a signed Mirt Merekebiya.
  for (const lot of input.lots) {
    if (lot.wasProcessed && !lot.hasSignedAcceptance) {
      blockers.push({
        code: ERROR_CODES.NOT_ACCEPTED_BY_CUSTOMER,
        message: `Lot ${lot.reference} has not been accepted by the customer.`,
      })
    }

    if (lot.status === 'DISPATCHED') {
      blockers.push({
        code: ERROR_CODES.ENTITY_NOT_IN_EXPECTED_STATE,
        message: `Lot ${lot.reference} has already been dispatched.`,
      })
    }

    if (lot.status === 'CONSUMED') {
      blockers.push({
        code: ERROR_CODES.ENTITY_NOT_IN_EXPECTED_STATE,
        message: `Lot ${lot.reference} was consumed by processing and no longer exists as stock.`,
      })
    }

    if (lot.status === 'RESERVED_FOR_JOB') {
      blockers.push({
        code: ERROR_CODES.LOT_ALREADY_COMMITTED,
        message: `Lot ${lot.reference} is committed to a scheduled processing job.`,
      })
    }
  }

  // 2. Customer holds — document compliance now, financial holds in Phase 2.
  for (const hold of input.customerHolds) {
    const mayOverride =
      hold.overridableBy !== undefined &&
      input.actorPermissions.has(hold.overridableBy) &&
      (input.overrideJustification?.trim().length ?? 0) >= 10

    if (mayOverride) {
      overridden.push(hold)
    } else {
      blockers.push(hold)
    }
  }

  if (blockers.length > 0) {
    return { cleared: false, blockers }
  }

  return { cleared: true, overriddenHolds: overridden }
}

/** Throwing form for the use case. */
export function assertClearedForDispatch(input: ClearanceInput): readonly HoldReason[] {
  const result = evaluateClearance(input)

  if (!result.cleared) {
    throw new BusinessRuleViolation(ERROR_CODES.CLEARANCE_FAILED, {
      message: 'This release cannot proceed.',
      details: {
        blockers: result.blockers.map((b) => ({ code: b.code, message: b.message })),
      },
    })
  }

  return result.overriddenHolds
}

// ── Gate pass ────────────────────────────────────────────────────────────────

export type GatePassStatus = 'ISSUED' | 'USED' | 'CANCELLED' | 'EXPIRED'

export interface GatePass {
  readonly id: string
  readonly number: string
  readonly status: GatePassStatus
  readonly vehicleRegistration: string
  readonly driverName: string
  readonly issuedAt: Date
  readonly expiresAt: Date
  readonly usedAt: Date | null
}

export interface GateOutAttempt {
  readonly pass: GatePass
  /** Read from the vehicle at the gate, not from the paperwork. */
  readonly presentedVehicleRegistration: string
  readonly at: Date
}

/**
 * THE M17 KEY CONTROL: "No vehicle leaves without a valid, unused pass."
 *
 * Single use is enforced as a STATUS TRANSITION inside a transaction, not by a
 * check-then-act: two officers scanning the same pass simultaneously must produce exactly
 * one gate-out, and only the database can guarantee that.
 *
 * This function is the domain half; the repository performs the conditional update
 * (`WHERE status = 'ISSUED'`) that makes it atomic.
 */
export function assertGatePassUsable(attempt: GateOutAttempt): void {
  const { pass } = attempt

  if (pass.status === 'USED') {
    throw new BusinessRuleViolation(ERROR_CODES.GATE_PASS_ALREADY_USED, {
      message: `Gate pass ${pass.number} has already been used.`,
      details: { gatePassNumber: pass.number, usedAt: pass.usedAt?.toISOString() },
    })
  }

  if (pass.status === 'CANCELLED') {
    throw new BusinessRuleViolation(ERROR_CODES.GATE_PASS_ALREADY_USED, {
      message: `Gate pass ${pass.number} was cancelled.`,
      details: { gatePassNumber: pass.number },
    })
  }

  if (pass.status === 'EXPIRED' || attempt.at >= pass.expiresAt) {
    throw new BusinessRuleViolation(ERROR_CODES.GATE_PASS_EXPIRED, {
      message: `Gate pass ${pass.number} expired at ${pass.expiresAt.toISOString()}.`,
      details: { gatePassNumber: pass.number, expiresAt: pass.expiresAt.toISOString() },
    })
  }

  // "the security officer at the gate verifies the vehicle against the pass".
  if (!registrationsMatch(pass.vehicleRegistration, attempt.presentedVehicleRegistration)) {
    throw new BusinessRuleViolation(ERROR_CODES.GATE_PASS_VEHICLE_MISMATCH, {
      message: `The vehicle at the gate does not match gate pass ${pass.number}.`,
      details: {
        gatePassNumber: pass.number,
        expectedVehicle: pass.vehicleRegistration,
        presentedVehicle: attempt.presentedVehicleRegistration,
      },
    })
  }
}

/**
 * Compare registrations ignoring spacing, punctuation and case.
 *
 * A gate officer reading a plate at night should not be defeated by a hyphen. The
 * comparison stays strict on the alphanumerics themselves.
 */
export function registrationsMatch(a: string, b: string): boolean {
  const normalise = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const left = normalise(a)
  const right = normalise(b)
  return left.length > 0 && left === right
}

/** Non-throwing form for the gate screen, which shows a red or green result. */
export function checkGatePass(attempt: GateOutAttempt): {
  valid: boolean
  reason: string | null
} {
  try {
    assertGatePassUsable(attempt)
    return { valid: true, reason: null }
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof BusinessRuleViolation ? error.message : 'Invalid gate pass.',
    }
  }
}
