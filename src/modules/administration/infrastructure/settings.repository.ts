import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

export interface SettingRow {
  readonly key: string
  readonly value: unknown
  readonly valueType: string
  readonly description: string
  readonly unit: string | null
  readonly editableByPermission: string
  readonly updatedAt: Date
  readonly updatedByName: string | null
}

export async function listSettings(tx: Tx): Promise<SettingRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select s.key, s.value, s.value_type, s.description, s.unit, s.editable_by_permission,
             s.updated_at, u.full_name as updated_by_name
      from public.system_setting s
      left join public.app_user u on u.id = s.updated_by
      order by s.key
    `,
  )

  return rows.map((row) => ({
    key: col.text(row.key),
    value: row.value,
    valueType: col.text(row.value_type),
    description: col.text(row.description),
    unit: col.textOrNull(row.unit),
    editableByPermission: col.text(row.editable_by_permission),
    updatedAt: col.date(row.updated_at),
    updatedByName: col.textOrNull(row.updated_by_name),
  }))
}

export async function findSetting(tx: Tx, key: string): Promise<SettingRow | undefined> {
  const rows = await rawRows(
    tx,
    sql`select key, value, value_type, description, unit, editable_by_permission, updated_at from public.system_setting where key = ${key} for update`,
  )
  const row = rows[0]
  if (!row) return undefined
  return {
    key: col.text(row.key),
    value: row.value,
    valueType: col.text(row.value_type),
    description: col.text(row.description),
    unit: col.textOrNull(row.unit),
    editableByPermission: col.text(row.editable_by_permission),
    updatedAt: col.date(row.updated_at),
    updatedByName: null,
  }
}

/** Insert the default row for a setting if it does not exist yet. Never overwrites a value an administrator set. */
export async function ensureSettingSeeded(
  tx: Tx,
  key: string,
  defaultValue: unknown,
  valueType: string,
  description: string,
  unit: string | null,
  editableByPermission: string,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into public.system_setting (
      id, key, value, value_type, description, unit, editable_by_permission,
      created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${key}, ${JSON.stringify(defaultValue)}::jsonb, ${valueType}, ${description},
      ${unit}, ${editableByPermission}, ${actorId}::uuid, now(), now()
    )
    on conflict (key) do nothing
  `)
}

/**
 * Update a setting — THE M23 KEY CONTROL. Old and new values are always both on the row
 * this writes to `system_setting_history`, which is append-only (migration 0009's trigger).
 */
export async function updateSetting(
  tx: Tx,
  key: string,
  oldValue: unknown,
  newValue: unknown,
  reason: string | null,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.system_setting
    set value = ${JSON.stringify(newValue)}::jsonb, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where key = ${key}
  `)

  await tx.execute(sql`
    insert into public.system_setting_history (id, setting_key, old_value, new_value, reason, changed_by, changed_at)
    values (${uuidv7()}, ${key}, ${JSON.stringify(oldValue)}::jsonb, ${JSON.stringify(newValue)}::jsonb, ${reason}, ${actorId}::uuid, now())
  `)
}

export interface SettingHistoryRow {
  readonly id: string
  readonly oldValue: unknown
  readonly newValue: unknown
  readonly reason: string | null
  readonly changedByName: string | null
  readonly changedAt: Date
}

export async function settingHistory(tx: Tx, key: string): Promise<SettingHistoryRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select h.id, h.old_value, h.new_value, h.reason, h.changed_at, u.full_name as changed_by_name
      from public.system_setting_history h
      left join public.app_user u on u.id = h.changed_by
      where h.setting_key = ${key}
      order by h.changed_at desc
      limit 50
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    oldValue: row.old_value,
    newValue: row.new_value,
    reason: col.textOrNull(row.reason),
    changedByName: col.textOrNull(row.changed_by_name),
    changedAt: col.date(row.changed_at),
  }))
}
