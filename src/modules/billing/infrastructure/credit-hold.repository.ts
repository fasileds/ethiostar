import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

export interface CreditHoldRow {
  readonly id: string
  readonly customerId: string
  readonly customerName: string
  readonly reason: string
  readonly note: string | null
  readonly isAutomatic: boolean
  readonly heldAt: Date
  readonly heldByName: string | null
}

const HOLD_SELECT = sql`
  select h.id, h.customer_id, cu.legal_name as customer_name, h.reason, h.note,
         h.is_automatic, h.held_at, u.full_name as held_by_name
  from public.customer_credit_hold h
  join public.customer cu on cu.id = h.customer_id
  left join public.app_user u on u.id = h.held_by
`

/** The currently-open hold for a customer, if any — used to keep automatic holds idempotent. */
export async function findOpenHold(tx: Tx, customerId: string): Promise<CreditHoldRow | null> {
  const rows = await rawRows(
    tx,
    sql`${HOLD_SELECT} where h.customer_id = ${customerId}::uuid and h.released_at is null limit 1`,
  )
  return rows[0] ? toRow(rows[0]) : null
}

function toRow(row: Record<string, unknown>): CreditHoldRow {
  return {
    id: col.text(row.id),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    reason: col.text(row.reason),
    note: col.textOrNull(row.note),
    isAutomatic: col.bool(row.is_automatic),
    heldAt: col.date(row.held_at),
    heldByName: col.textOrNull(row.held_by_name),
  }
}

export async function listOpenHolds(tx: Tx): Promise<CreditHoldRow[]> {
  const rows = await rawRows(
    tx,
    sql`${HOLD_SELECT} where h.released_at is null order by h.held_at desc`,
  )
  return rows.map(toRow)
}

export interface InsertHoldInput {
  readonly customerId: string
  readonly reason: string
  readonly note: string | null
  readonly isAutomatic: boolean
  readonly heldBy: string | null
}

export async function insertHold(tx: Tx, input: InsertHoldInput): Promise<string> {
  const id = uuidv7()
  await tx.execute(sql`
    insert into public.customer_credit_hold (
      id, customer_id, reason, note, is_automatic, held_by, held_at
    ) values (
      ${id}::uuid, ${input.customerId}::uuid, ${input.reason}, ${input.note},
      ${input.isAutomatic}, ${input.heldBy}::uuid, now()
    )
  `)
  return id
}

export async function releaseHold(tx: Tx, holdId: string, actorId: string): Promise<void> {
  await tx.execute(sql`
    update public.customer_credit_hold
    set released_by = ${actorId}::uuid, released_at = now()
    where id = ${holdId}::uuid and released_at is null
  `)
}
