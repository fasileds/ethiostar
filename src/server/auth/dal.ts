import 'server-only'
import { cache } from 'react'
import { eq, and, or, isNull, gt, inArray } from 'drizzle-orm'
import { createSupabaseServerClient } from '@platform/supabase/server-client'
import { withAuthenticatedDb, type DbClaims, type Tx } from '@db/client'
import { appUser, userRole, role, rolePermission, permission, userScope } from '@db/schema'
import type { Actor, ScopeEntry } from '@modules/identity'
import { UnauthenticatedError } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { systemClock } from '@core/clock/clock'
import { requireStaffRealm, requireCustomerRealm } from './authorize'

/**
 * THE DATA ACCESS LAYER — the single place the caller is resolved.
 *
 * Nothing else reads the session. Wrapped in React `cache()` so one render pass resolves
 * the actor once, however many components ask.
 *
 * CRITICAL PROPERTY: this re-reads `app_user.status` and the live permission set from the
 * database on every request, rather than trusting the JWT claims.
 *
 * A JWT is self-contained: a suspended user keeps a valid token until it expires (5 min).
 * Because the DAL is already the single resolution point, one indexed lookup per render
 * pass makes revocation effectively immediate — the 5-minute window then applies only to
 * proxy.ts's optimistic redirect, which by design touches no database.
 *
 * docs/adr/0014-supabase-auth.md · docs/architecture/05-security.md §5.1
 */

/** Claims injected by public.custom_access_token_hook. */
interface AppJwtClaims {
  actor_kind?: string
  customer_id?: string | null
  app_role?: string | null
  must_change_password?: boolean
  permissions_version?: number
  status?: string
  aal?: string
}

interface ProfileRow {
  id: string
  actorKind: string
  customerId: string | null
  email: string
  fullName: string
  status: string
  mustChangePassword: boolean
  preferredLocale: string
  permissionsVersion: number
}

async function loadProfile(tx: Tx, userId: string): Promise<ProfileRow | undefined> {
  const rows = await tx
    .select({
      id: appUser.id,
      actorKind: appUser.actorKind,
      customerId: appUser.customerId,
      email: appUser.email,
      fullName: appUser.fullName,
      status: appUser.status,
      mustChangePassword: appUser.mustChangePassword,
      preferredLocale: appUser.preferredLocale,
      permissionsVersion: appUser.permissionsVersion,
    })
    .from(appUser)
    .where(eq(appUser.id, userId))
    .limit(1)

  return rows[0]
}

/** Active, unexpired role assignments. */
async function loadRoles(tx: Tx, userId: string): Promise<Array<{ code: string; id: string }>> {
  return tx
    .select({ code: role.code, id: role.id })
    .from(userRole)
    .innerJoin(role, eq(role.id, userRole.roleId))
    .where(
      and(
        eq(userRole.userId, userId),
        eq(role.isActive, true),
        or(isNull(userRole.expiresAt), gt(userRole.expiresAt, systemClock.now())),
      ),
    )
}

async function loadPermissions(tx: Tx, roleIds: readonly string[]): Promise<Set<string>> {
  if (roleIds.length === 0) return new Set<string>()

  const rows = await tx
    .selectDistinct({ code: permission.code })
    .from(rolePermission)
    .innerJoin(permission, eq(permission.id, rolePermission.permissionId))
    .where(inArray(rolePermission.roleId, [...roleIds]))

  return new Set(rows.map((r) => r.code))
}

async function loadScopes(tx: Tx, userId: string): Promise<ScopeEntry[]> {
  const rows = await tx
    .select({ kind: userScope.scopeKind, id: userScope.scopeId })
    .from(userScope)
    .where(eq(userScope.userId, userId))

  return rows.map((s): ScopeEntry => ({ kind: s.kind as ScopeEntry['kind'], id: s.id }))
}

function toDbClaims(userId: string, claims: AppJwtClaims): DbClaims {
  return {
    sub: userId,
    role: 'authenticated',
    ...(claims.actor_kind === 'customer' || claims.actor_kind === 'staff'
      ? { actor_kind: claims.actor_kind }
      : {}),
    customer_id: claims.customer_id ?? null,
    // fn_is_staff() is `actor_kind = 'staff' AND status = 'ACTIVE'`. Passing actor_kind
    // without status satisfies half the predicate and denies every staff policy, which
    // surfaces as an administrator with no roles rather than as an error.
    ...(claims.status ? { status: claims.status } : {}),
    ...(claims.aal === 'aal1' || claims.aal === 'aal2' ? { aal: claims.aal } : {}),
  }
}

function buildActor(
  profile: ProfileRow,
  roles: ReadonlyArray<{ code: string }>,
  permissions: Set<string>,
  scopes: ScopeEntry[],
  assuranceLevel: 'aal1' | 'aal2',
): Actor {
  return {
    userId: profile.id,
    actorKind: profile.actorKind === 'customer' ? 'customer' : 'staff',
    customerId: profile.customerId,
    email: profile.email,
    fullName: profile.fullName,
    status: profile.status as Actor['status'],
    mustChangePassword: profile.mustChangePassword,
    locale: profile.preferredLocale === 'am' ? 'am' : 'en',
    roles: roles.map((r) => r.code),
    permissions,
    scopes,
    assuranceLevel,
    permissionsVersion: profile.permissionsVersion,
  }
}

/**
 * Resolve the current actor, or null when unauthenticated.
 * Memoised per render pass by React `cache`.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const supabase = await createSupabaseServerClient()

  // getClaims(), NOT getUser().
  //
  // Both verify the token against the auth server — this project signs with a symmetric
  // secret, so getClaims() makes the same validating round trip and carries the same
  // guarantee. getSession() does neither and must never be trusted server-side.
  //
  // The difference that matters: `custom_access_token_hook` injects actor_kind, status,
  // customer_id and permissions_version at the TOP LEVEL of the JWT, and getUser() cannot
  // see them. It returns the stored `auth.users` row, whose app_metadata holds only
  // { provider, providers } — the hook never touches that row, only the issued token.
  //
  // Reading them from `user.app_metadata` therefore yielded undefined every time, so
  // fn_is_staff() saw no actor_kind, the RLS policies on role/user_role/permission denied
  // everything, and a System Administrator with all 85 permissions resolved to zero roles
  // and rendered as "No role assigned" with a one-item navigation.
  const { data, error } = await supabase.auth.getClaims()

  const claims = data?.claims as (AppJwtClaims & { sub?: string }) | undefined
  if (error || !claims?.sub) return null

  const userId = claims.sub
  const dbClaims = toDbClaims(userId, claims)
  const assuranceLevel = claims.aal === 'aal2' ? 'aal2' : 'aal1'

  // Authority comes from the DATABASE, not from the token.
  return withAuthenticatedDb(dbClaims, async (tx) => {
    const profile = await loadProfile(tx, userId)
    if (!profile) return null

    const roles = await loadRoles(tx, userId)
    const permissions = await loadPermissions(
      tx,
      roles.map((r) => r.id),
    )
    const scopes = await loadScopes(tx, userId)

    return buildActor(profile, roles, permissions, scopes, assuranceLevel)
  })
})

/** Resolve the actor or throw. Use in any authenticated surface. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) throw new UnauthenticatedError()

  if (actor.status !== 'ACTIVE') {
    throw new UnauthenticatedError(ERROR_CODES.ACCOUNT_SUSPENDED, {
      message: 'This account is not active.',
    })
  }

  return actor
}

/** Require an authenticated EthioStar staff member. */
export async function requireStaff(): Promise<Actor> {
  const actor = await requireActor()
  requireStaffRealm(actor)
  return actor
}

/** Require an authenticated customer with a bound customer record. */
export async function requireCustomer(): Promise<Actor> {
  const actor = await requireActor()
  requireCustomerRealm(actor)
  return actor
}

/** The DbClaims for the current actor, for repositories that open their own transaction. */
export async function currentClaims(): Promise<DbClaims> {
  const actor = await requireActor()
  return {
    sub: actor.userId,
    role: 'authenticated',
    actor_kind: actor.actorKind,
    customer_id: actor.customerId,
    // fn_is_staff() needs this as well as actor_kind — see toDbClaims above.
    status: actor.status,
    aal: actor.assuranceLevel,
  }
}
