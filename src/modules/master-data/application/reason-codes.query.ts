import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/** A reason code, for the dropdowns every "explain why" control in the system needs. */
export interface ReasonCodeOption {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly requiresNarrative: boolean
}

export async function reasonCodesByCategory(
  tx: Tx,
  categoryCode: string,
): Promise<ReasonCodeOption[]> {
  const rows = await rawRows(
    tx,
    sql`
      select rc.id, rc.code, rc.name_en, rc.requires_narrative
      from public.reason_code rc
      join public.reason_code_category cat on cat.id = rc.category_id
      where cat.code = ${categoryCode} and rc.is_active
      order by rc.sort_order, rc.name_en
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name_en),
    requiresNarrative: col.bool(row.requires_narrative),
  }))
}
