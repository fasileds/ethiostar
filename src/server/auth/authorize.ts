import 'server-only'
import {
  type Actor,
  type ScopeTarget,
  hasPermission,
  isWithinScope,
  isActive,
} from '@modules/identity'
import { ForbiddenError, UnauthenticatedError, NotFoundError } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

/**
 * THE SINGLE AUTHORIZATION DECISION POINT.
 *
 * Called at the top of EVERY use case that writes, and every read of another party's data.
 *
 * Why here and not in the page or the proxy:
 *   • A Server Action is a directly reachable POST endpoint whose id is discoverable. The
 *     page.tsx that renders the button is not a guard.
 *   • proxy.ts runs on every request including prefetches, so it cannot afford database
 *     lookups and is an optimistic redirect only.
 *
 * The check is close to the data, which is the only placement that is actually correct.
 * docs/adr/0011-authorization-model.md
 */

export interface AuthorizationDenial {
  readonly actorId: string
  readonly permission: string
  readonly reason: 'NOT_HELD' | 'OUT_OF_SCOPE' | 'INACTIVE' | 'MFA_REQUIRED' | 'PASSWORD_CHANGE'
  readonly target?: ScopeTarget | undefined
}

/** Set by the composition root so denials reach the audit log without a layering violation. */
let denialRecorder: ((denial: AuthorizationDenial) => void) | null = null

export function setDenialRecorder(recorder: (denial: AuthorizationDenial) => void): void {
  denialRecorder = recorder
}

function recordDenial(denial: AuthorizationDenial): void {
  // Repeated denials by one actor are a security signal worth having — and they feed the
  // Phase 3 M27 risk monitor for free.
  denialRecorder?.(denial)
}

export interface RequirePermissionOptions {
  /** The location the action targets. Location-bound use cases MUST supply this. */
  readonly target?: ScopeTarget | undefined
  /** Require MFA (aal2) regardless of the actor's role default. */
  readonly requireMfa?: boolean
}

/**
 * Account-level gates that apply before any permission is considered.
 *
 * A suspended user is blocked immediately regardless of a still-valid JWT — this is what
 * makes revocation effectively immediate (docs/adr/0014 §revocation). And credentials
 * issued on approval force a password change before anything else can be done (M04).
 */
function assertUsable(actor: Actor, permission: string): void {
  if (!isActive(actor)) {
    recordDenial({ actorId: actor.userId, permission, reason: 'INACTIVE' })
    throw new ForbiddenError(ERROR_CODES.ACCOUNT_SUSPENDED, {
      message: 'This account is not active.',
    })
  }

  if (actor.mustChangePassword) {
    recordDenial({ actorId: actor.userId, permission, reason: 'PASSWORD_CHANGE' })
    throw new ForbiddenError(ERROR_CODES.PASSWORD_CHANGE_REQUIRED, {
      message: 'You must set a new password before continuing.',
    })
  }
}

/**
 * Assert the actor may perform `permission`, optionally at `target`.
 * Throws ForbiddenError on failure. Deny by default.
 */
export function requirePermission(
  actor: Actor | null,
  permission: string,
  options: RequirePermissionOptions = {},
): asserts actor is Actor {
  if (!actor) {
    throw new UnauthenticatedError()
  }

  assertUsable(actor, permission)

  if (!hasPermission(actor, permission)) {
    recordDenial({
      actorId: actor.userId,
      permission,
      reason: 'NOT_HELD',
      target: options.target,
    })
    throw new ForbiddenError(ERROR_CODES.FORBIDDEN, {
      message: 'You do not have permission to perform this action.',
      details: { permission },
    })
  }

  if (!isWithinScope(actor, options.target ?? {})) {
    recordDenial({
      actorId: actor.userId,
      permission,
      reason: 'OUT_OF_SCOPE',
      target: options.target,
    })
    throw new ForbiddenError(ERROR_CODES.OUT_OF_SCOPE, {
      message: 'This location is outside your assigned scope.',
      details: { permission },
    })
  }

  if (options.requireMfa && actor.assuranceLevel !== 'aal2') {
    recordDenial({ actorId: actor.userId, permission, reason: 'MFA_REQUIRED' })
    throw new ForbiddenError(ERROR_CODES.MFA_REQUIRED, {
      message: 'Two-factor authentication is required for this action.',
    })
  }
}

/** Non-throwing variant, for deciding whether to render a control. */
export function canPerform(
  actor: Actor | null,
  permission: string,
  target: ScopeTarget = {},
): boolean {
  if (!actor || !isActive(actor) || actor.mustChangePassword) return false
  return hasPermission(actor, permission) && isWithinScope(actor, target)
}

/**
 * OBJECT-LEVEL authorization — separate from, and additional to, the permission check.
 *
 * Holding `delivery_request:view` does not entitle a customer to view ANOTHER customer's
 * request. This is the IDOR guard.
 *
 * Throws NotFoundError, not ForbiddenError, on a cross-tenant probe: a 403 confirms the id
 * exists, which is itself a leak. docs/architecture/05-security.md §5.2
 */
export function assertAccessible(
  actor: Actor,
  entity: { customerId?: string | null } | null | undefined,
  entityName: string,
): void {
  if (!entity) {
    throw NotFoundError.of(entityName)
  }

  if (actor.actorKind === 'customer') {
    if (!entity.customerId || entity.customerId !== actor.customerId) {
      // Deliberately indistinguishable from "does not exist".
      throw NotFoundError.of(entityName)
    }
  }
}

/** Require a staff-realm actor. */
export function requireStaffRealm(actor: Actor | null): asserts actor is Actor {
  if (!actor) throw new UnauthenticatedError()
  if (actor.actorKind !== 'staff') {
    throw new ForbiddenError(ERROR_CODES.FORBIDDEN, {
      message: 'This area is for EthioStar staff.',
    })
  }
}

/** Require a customer-realm actor with a bound customer. */
export function requireCustomerRealm(actor: Actor | null): asserts actor is Actor {
  if (!actor) throw new UnauthenticatedError()
  if (actor.actorKind !== 'customer' || !actor.customerId) {
    throw new ForbiddenError(ERROR_CODES.FORBIDDEN, {
      message: 'This area is for EthioStar customers.',
    })
  }
}
