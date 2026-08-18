import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

/**
 * Admin CRUD for reason codes — the controlled vocabulary behind every "explain why" control
 * (stock adjustments, schedule delays, variance overrides). Read access for dropdowns is
 * `reason-codes.query.ts`; this file is the write side, used only by the admin screen.
 */

export interface ReasonCodeCategoryRow {
  readonly id: string
  readonly code: string
  readonly name: string
}

export async function listReasonCodeCategories(tx: Tx): Promise<ReasonCodeCategoryRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, name_en
      from public.reason_code_category
      where is_active
      order by name_en
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name_en),
  }))
}

export interface ReasonCodeAdminRow {
  readonly id: string
  readonly categoryId: string
  readonly categoryName: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly requiresNarrative: boolean
  readonly isException: boolean
  readonly isActive: boolean
}

export async function listAllReasonCodes(tx: Tx): Promise<ReasonCodeAdminRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select rc.id, rc.category_id, cat.name_en as category_name, rc.code, rc.name_en,
             rc.description, rc.requires_narrative, rc.is_exception, rc.is_active
      from public.reason_code rc
      join public.reason_code_category cat on cat.id = rc.category_id
      order by cat.name_en, rc.sort_order, rc.name_en
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    categoryId: col.text(row.category_id),
    categoryName: col.text(row.category_name),
    code: col.text(row.code),
    name: col.text(row.name_en),
    description: col.textOrNull(row.description),
    requiresNarrative: col.bool(row.requires_narrative),
    isException: col.bool(row.is_exception),
    isActive: col.bool(row.is_active),
  }))
}

export interface CreateReasonCodeInput {
  readonly categoryId: string
  readonly code: string
  readonly nameEn: string
  readonly description: string | null
  readonly requiresNarrative: boolean
  readonly isException: boolean
  readonly actorId: string
}

export async function createReasonCode(tx: Tx, input: CreateReasonCodeInput): Promise<void> {
  await tx.execute(sql`
    insert into public.reason_code (
      id, category_id, code, name_en, description, requires_narrative, is_exception,
      sort_order, is_active, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.categoryId}::uuid, ${input.code}, ${input.nameEn}, ${input.description},
      ${input.requiresNarrative}, ${input.isException},
      0, true, ${input.actorId}::uuid, now(), now()
    )
  `)
}

export async function setReasonCodeActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.reason_code
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}
