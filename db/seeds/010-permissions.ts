import { sql } from 'drizzle-orm'
import { PERMISSIONS } from '../../src/modules/identity/domain/permissions'
import { ROLES } from '../../src/modules/identity/domain/roles'
import { uuidv7 } from '../../src/core/ids/id-generator'
import { SYSTEM_ACTOR_ID } from '../../src/modules/identity/domain/actor'
import type { SeedContext } from './types'

/**
 * Syncs the code-owned permission catalogue and the DEFAULT role→permission mapping.
 *
 * Runs on EVERY deploy and is idempotent, so a permission that ships with new code can
 * never be missing in production.
 *
 * IMPORTANT ASYMMETRY:
 *   • Permissions are reconciled — added and updated to match the catalogue exactly.
 *   • Role→permission grants are seeded ONLY when a role has none, because EthioStar
 *     edits them in the admin console (M23) and a deploy must never silently revert an
 *     administrator's decision.
 */
export async function seedPermissions(ctx: SeedContext): Promise<void> {
  const { tx, log } = ctx

  // ── Permissions: reconcile to the catalogue ────────────────────────────────
  let inserted = 0
  let updated = 0

  for (const perm of PERMISSIONS) {
    const result = await tx.execute(sql`
      insert into public.permission
        (id, code, resource, action, description, group_code, is_read_only, created_by)
      values (
        ${uuidv7()}, ${perm.code}, ${perm.resource}, ${perm.action},
        ${perm.description}, ${perm.group}, ${perm.readOnly}, ${SYSTEM_ACTOR_ID}
      )
      on conflict (code) do update set
        resource     = excluded.resource,
        action       = excluded.action,
        description  = excluded.description,
        group_code   = excluded.group_code,
        is_read_only = excluded.is_read_only,
        updated_at   = now()
      returning (xmax = 0) as was_inserted
    `)

    const rows = result as unknown as Array<{ was_inserted: boolean }>
    if (rows[0]?.was_inserted) inserted += 1
    else updated += 1
  }

  log(`permissions: ${inserted} inserted, ${updated} reconciled (${PERMISSIONS.length} total)`)

  // Warn about permissions in the database that the catalogue no longer defines. Not
  // deleted automatically: a role may still grant it, and silently revoking authority
  // during a deploy is worse than a warning.
  const orphans = await tx.execute(sql`
    select code from public.permission
    where code <> all(${sql.param(PERMISSIONS.map((p) => p.code))}::text[])
  `)
  const orphanRows = orphans as unknown as Array<{ code: string }>
  if (orphanRows.length > 0) {
    log(
      `WARNING: ${orphanRows.length} permission(s) exist in the database but not in the ` +
        `catalogue: ${orphanRows.map((r) => r.code).join(', ')}. ` +
        `Remove the grants, then delete them in an explicit migration.`,
    )
  }

  // ── Roles ─────────────────────────────────────────────────────────────────
  for (const roleDef of ROLES) {
    await tx.execute(sql`
      insert into public.role
        (id, code, name_en, name_am, description, is_system, requires_mfa, created_by)
      values (
        ${uuidv7()}, ${roleDef.code}, ${roleDef.nameEn}, ${roleDef.nameAm},
        ${roleDef.description}, true, ${roleDef.requiresMfa}, ${SYSTEM_ACTOR_ID}
      )
      on conflict (code) do update set
        name_en      = excluded.name_en,
        name_am      = excluded.name_am,
        description  = excluded.description,
        requires_mfa = excluded.requires_mfa,
        updated_at   = now()
    `)
  }
  log(`roles: ${ROLES.length} reconciled`)

  // ── Default grants — only for roles that have none ─────────────────────────
  let seededRoles = 0

  for (const roleDef of ROLES) {
    const existing = await tx.execute(sql`
      select count(*)::int as n
      from public.role_permission rp
      join public.role r on r.id = rp.role_id
      where r.code = ${roleDef.code}
    `)
    const count = (existing as unknown as Array<{ n: number }>)[0]?.n ?? 0

    // An administrator has configured this role. Do not touch it.
    if (count > 0) continue

    const codes = [...new Set(roleDef.permissions)]
    await tx.execute(sql`
      insert into public.role_permission (role_id, permission_id, granted_by)
      select r.id, p.id, ${SYSTEM_ACTOR_ID}
      from public.role r
      cross join public.permission p
      where r.code = ${roleDef.code}
        and p.code = any(${sql.param(codes)}::text[])
      on conflict do nothing
    `)
    seededRoles += 1
  }

  log(
    seededRoles > 0
      ? `role grants: seeded defaults for ${seededRoles} role(s)`
      : 'role grants: all roles already configured — left untouched',
  )
}
