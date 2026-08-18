import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { NotFoundError } from '@core/errors/app-error'

/**
 * Identity writes — everything downstream of GoTrue creating the `auth.users` row.
 *
 * `app_user` is never inserted here: `fn_handle_new_auth_user()` (migration 0002) does that
 * from `raw_user_meta_data` the moment GoTrue creates the row, so a profile can never exist
 * without its auth user or vice versa. What this file owns is what happens AFTER — role
 * assignment, scoping, suspension — driven by staff working in the admin console (M23).
 */

export interface AssignRoleInput {
  readonly userId: string
  readonly roleCode: string
  readonly assignedBy: string
  readonly expiresAt?: Date | null
}

/** Assign a role by code. Re-assigning an already-held role is a no-op, not an error. */
export async function assignRole(tx: Tx, input: AssignRoleInput): Promise<void> {
  const roleRows = await rawRows(
    tx,
    sql`select id from public.role where code = ${input.roleCode} and is_active limit 1`,
  )
  const role = roleRows[0]
  if (!role) throw NotFoundError.of('Role', input.roleCode)

  await tx.execute(sql`
    insert into public.user_role (user_id, role_id, assigned_at, assigned_by, expires_at)
    values (${input.userId}::uuid, ${col.text(role.id)}::uuid, now(), ${input.assignedBy}::uuid,
            ${input.expiresAt ?? null})
    on conflict (user_id, role_id) do update
      set expires_at = excluded.expires_at, assigned_by = excluded.assigned_by, assigned_at = now()
  `)

  await bumpPermissionsVersion(tx, input.userId)
}

export async function revokeRole(tx: Tx, userId: string, roleCode: string): Promise<void> {
  await tx.execute(sql`
    delete from public.user_role
    where user_id = ${userId}::uuid
      and role_id = (select id from public.role where code = ${roleCode} limit 1)
  `)
  await bumpPermissionsVersion(tx, userId)
}

/**
 * Bump the version stamped into the JWT.
 *
 * A role change does not retroactively rewrite an already-issued token — the change takes
 * effect on the next refresh, which `custom_access_token_hook` ties to this counter.
 */
async function bumpPermissionsVersion(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`
    update public.app_user set permissions_version = permissions_version + 1
    where id = ${userId}::uuid
  `)
}

export interface AddScopeInput {
  readonly userId: string
  readonly scopeKind: 'global' | 'branch' | 'warehouse' | 'room'
  readonly scopeId: string | null
}

/** Grant a scope row. "A store keeper of Room A cannot post movements in Room B" starts here. */
export async function addUserScope(tx: Tx, input: AddScopeInput): Promise<void> {
  await tx.execute(sql`
    insert into public.user_scope (id, user_id, scope_kind, scope_id, created_by, created_at, updated_at)
    values (${uuidv7()}, ${input.userId}::uuid, ${input.scopeKind}, ${input.scopeId}::uuid,
            ${input.userId}::uuid, now(), now())
    on conflict (user_id, scope_kind, scope_id) do nothing
  `)
}

export async function removeUserScope(
  tx: Tx,
  userId: string,
  scopeKind: string,
  scopeId: string | null,
): Promise<void> {
  await tx.execute(sql`
    delete from public.user_scope
    where user_id = ${userId}::uuid and scope_kind = ${scopeKind}
      and scope_id is not distinct from ${scopeId}::uuid
  `)
}

/**
 * Suspend a user.
 *
 * `status` is re-read from the database by `requireActor()` on every request
 * (docs/adr/0014), which is what makes this effectively immediate even though the user's
 * JWT remains cryptographically valid until it expires.
 */
export async function suspendUser(
  tx: Tx,
  userId: string,
  reason: string,
  suspendedAt: Date,
): Promise<void> {
  await tx.execute(sql`
    update public.app_user
    set status = 'SUSPENDED', suspended_reason = ${reason}, suspended_at = ${suspendedAt},
        updated_at = now()
    where id = ${userId}::uuid
  `)
}

export async function reactivateUser(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`
    update public.app_user
    set status = 'ACTIVE', suspended_reason = null, suspended_at = null, updated_at = now()
    where id = ${userId}::uuid
  `)
}

export async function setMfaRequired(tx: Tx, userId: string, required: boolean): Promise<void> {
  await tx.execute(sql`
    update public.app_user set mfa_required = ${required}, updated_at = now()
    where id = ${userId}::uuid
  `)
}
