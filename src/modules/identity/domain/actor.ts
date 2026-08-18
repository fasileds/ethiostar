import type { ActorKind } from '@config/constants'

/**
 * The authenticated caller, resolved once per request by the Data Access Layer.
 *
 * Two orthogonal dimensions of authority:
 *   • PERMISSIONS — what actions this actor may perform at all.
 *   • SCOPE       — which branches, warehouses or rooms (staff), or which customer (portal).
 *
 * Holding `store_placement:transfer` does not let a store keeper move stock in a room
 * outside their scope, and being scoped to a room does not grant the permission. Both are
 * required, always. M01: "a store keeper of Room A cannot post movements in Room B."
 */

export type ScopeKind = 'global' | 'branch' | 'warehouse' | 'room'

export interface ScopeEntry {
  readonly kind: ScopeKind
  readonly id: string | null
}

/** The location a permission check is being made against. */
export interface ScopeTarget {
  readonly branchId?: string | undefined
  readonly warehouseId?: string | undefined
  readonly roomId?: string | undefined
  readonly customerId?: string | undefined
}

export interface Actor {
  readonly userId: string
  readonly actorKind: ActorKind
  /** Set for portal users; null for staff. */
  readonly customerId: string | null
  readonly email: string
  readonly fullName: string
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'LOCKED' | 'DORMANT'
  readonly mustChangePassword: boolean
  readonly locale: 'en' | 'am'
  readonly roles: readonly string[]
  readonly permissions: ReadonlySet<string>
  readonly scopes: readonly ScopeEntry[]
  /** Authenticator assurance level from the JWT. `aal2` means MFA was completed. */
  readonly assuranceLevel: 'aal1' | 'aal2'
  readonly permissionsVersion: number
}

export function isStaff(actor: Actor): boolean {
  return actor.actorKind === 'staff'
}

export function isCustomer(actor: Actor): boolean {
  return actor.actorKind === 'customer'
}

export function isActive(actor: Actor): boolean {
  return actor.status === 'ACTIVE'
}

/** Permission check only — scope is checked separately by `isWithinScope`. */
export function hasPermission(actor: Actor, permission: string): boolean {
  return actor.permissions.has(permission)
}

export function hasAnyPermission(actor: Actor, permissions: readonly string[]): boolean {
  return permissions.some((permission) => actor.permissions.has(permission))
}

export function hasGlobalScope(actor: Actor): boolean {
  return actor.scopes.some((scope) => scope.kind === 'global')
}

/**
 * Is `target` inside this actor's data scope?
 *
 * DENY BY DEFAULT. An actor with no scope rows is scoped to nothing — absence of a rule is
 * not permission. A `global` scope entry satisfies every target.
 *
 * A target dimension that is not supplied is not checked: a permission check with no
 * location (`{}`) passes scope, which is correct for actions that are not location-bound
 * (viewing the customer list). Location-bound use cases MUST pass the location.
 */
export function isWithinScope(actor: Actor, target: ScopeTarget = {}): boolean {
  // Portal users are scoped to their own customer, and to nothing else.
  if (isCustomer(actor)) {
    if (target.customerId === undefined) return true
    return target.customerId === actor.customerId
  }

  if (hasGlobalScope(actor)) return true

  const dimensions: Array<[ScopeKind, string | undefined]> = [
    ['branch', target.branchId],
    ['warehouse', target.warehouseId],
    ['room', target.roomId],
  ]

  const supplied = dimensions.filter(([, id]) => id !== undefined)
  if (supplied.length === 0) return true

  // Every supplied dimension must be covered by at least one scope entry.
  return supplied.every(([kind, id]) =>
    actor.scopes.some((scope) => scope.kind === kind && scope.id === id),
  )
}

/** Ids of a given scope kind, for adding a predicate to a query. */
export function scopeIdsOfKind(actor: Actor, kind: ScopeKind): string[] {
  return actor.scopes
    .filter((scope) => scope.kind === kind && scope.id !== null)
    .map((scope) => scope.id as string)
}

/**
 * A system actor for the background worker, which has no user context.
 * Holds no permissions: worker jobs act through use cases that take an explicit actor, or
 * through the audited `infrastructure/system/` namespace — never by pretending to be an
 * administrator.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-7000-8000-000000000000'

export function systemActor(): Actor {
  return {
    userId: SYSTEM_ACTOR_ID,
    actorKind: 'staff',
    customerId: null,
    email: 'system@ethiostar.internal',
    fullName: 'System',
    status: 'ACTIVE',
    mustChangePassword: false,
    locale: 'en',
    roles: [],
    permissions: new Set<string>(),
    scopes: [{ kind: 'global', id: null }],
    assuranceLevel: 'aal1',
    permissionsVersion: 1,
  }
}
