import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

export interface StaffUserRow {
  readonly id: string
  readonly fullName: string
  readonly email: string
  readonly status: string
  readonly roles: readonly string[]
  readonly lastSeenAt: Date | null
}

export async function listStaffUsers(tx: Tx): Promise<StaffUserRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select u.id, u.full_name, u.email, u.status, u.last_seen_at,
             coalesce(array_agg(r.code) filter (where r.code is not null), '{}') as roles
      from public.app_user u
      left join public.user_role ur on ur.user_id = u.id
      left join public.role r on r.id = ur.role_id
      where u.actor_kind = 'staff'
      group by u.id
      order by u.full_name
      limit 200
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    fullName: col.text(row.full_name),
    email: col.text(row.email),
    status: col.text(row.status),
    roles: (row.roles as string[]) ?? [],
    lastSeenAt: col.dateOrNull(row.last_seen_at),
  }))
}
