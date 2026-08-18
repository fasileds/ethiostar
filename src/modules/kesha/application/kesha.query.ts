import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import {
  rawRows,
  col,
  listLimit,
  keysetBefore,
  toListPage,
  cursorValue,
  type ListPage,
} from '@db/helpers/list-query'

/**
 * M13 read models.
 *
 * `keshaPositions` computes the position from the LEDGER, not from `kesha_balance`, and
 * returns both so they can be compared. The projection exists for speed; the ledger is the
 * truth. A screen that only shows the projection can never reveal that the two have drifted —
 * which is the single failure this module is here to catch.
 */

export interface KeshaPosition {
  readonly customerId: string
  readonly customerName: string
  readonly bagTypeId: string | null
  readonly bagTypeName: string | null
  readonly heldFull: number
  readonly heldEmpty: number
  readonly damaged: number
  readonly returned: number
  /** Recomputed from kesha_movement. Should equal heldFull + heldEmpty. */
  readonly ledgerHeld: number
  readonly drift: number
  readonly lastMovementAt: Date | null
}

export async function keshaPositions(tx: Tx, customerId?: string): Promise<KeshaPosition[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        b.customer_id, b.bag_type_id,
        b.held_full, b.held_empty, b.damaged, b.returned, b.last_movement_at,
        cu.legal_name as customer_name,
        bt.name_en    as bag_type_name,
        coalesce(led.ledger_held, 0)::int as ledger_held
      from public.kesha_balance b
      join public.customer cu on cu.id = b.customer_id
      left join public.bag_type bt on bt.id = b.bag_type_id
      left join lateral (
        select sum(m.kesha_delta) as ledger_held
        from public.kesha_movement m
        where m.customer_id = b.customer_id
          and (m.bag_type_id is not distinct from b.bag_type_id)
      ) led on true
      where 1 = 1
        ${customerId ? sql`and b.customer_id = ${customerId}::uuid` : sql``}
      order by cu.legal_name, bt.name_en
      limit 200
    `,
  )

  return rows.map((row) => {
    const heldFull = col.int(row.held_full)
    const heldEmpty = col.int(row.held_empty)
    const ledgerHeld = col.int(row.ledger_held)

    return {
      customerId: col.text(row.customer_id),
      customerName: col.text(row.customer_name),
      bagTypeId: col.textOrNull(row.bag_type_id),
      bagTypeName: col.textOrNull(row.bag_type_name),
      heldFull,
      heldEmpty,
      damaged: col.int(row.damaged),
      returned: col.int(row.returned),
      ledgerHeld,
      drift: ledgerHeld - (heldFull + heldEmpty),
      lastMovementAt: col.dateOrNull(row.last_movement_at),
    }
  })
}

export interface KeshaMovementRow {
  readonly id: string
  readonly customerName: string
  readonly bagTypeName: string | null
  readonly movementType: string
  readonly keshaDelta: number
  readonly condition: string
  readonly consignmentReference: string | null
  readonly reasonCode: string | null
  readonly note: string | null
  readonly occurredAt: Date
}

export async function listKeshaMovements(
  tx: Tx,
  filters: {
    customerId?: string | undefined
    movementType?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<KeshaMovementRow>> {
  const limit = listLimit(filters.limit)

  const rows = await rawRows(
    tx,
    sql`
      select
        m.id, m.movement_type, m.kesha_delta, m.condition, m.reason_code, m.note,
        m.occurred_at,
        cu.legal_name  as customer_name,
        bt.name_en     as bag_type_name,
        cons.reference as consignment_reference
      from public.kesha_movement m
      join public.customer cu on cu.id = m.customer_id
      left join public.bag_type bt on bt.id = m.bag_type_id
      left join public.consignment cons on cons.id = m.consignment_id
      where 1 = 1
        ${filters.customerId ? sql`and m.customer_id = ${filters.customerId}::uuid` : sql``}
        ${filters.movementType ? sql`and m.movement_type = ${filters.movementType}` : sql``}
        ${keysetBefore(sql`m.occurred_at`, sql`m.id`, filters.cursor)}
      order by m.occurred_at desc, m.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(
    rows.map((row): KeshaMovementRow => ({
      id: col.text(row.id),
      customerName: col.text(row.customer_name),
      bagTypeName: col.textOrNull(row.bag_type_name),
      movementType: col.text(row.movement_type),
      keshaDelta: col.int(row.kesha_delta),
      condition: col.text(row.condition),
      consignmentReference: col.textOrNull(row.consignment_reference),
      reasonCode: col.textOrNull(row.reason_code),
      note: col.textOrNull(row.note),
      occurredAt: col.date(row.occurred_at),
    })),
    limit,
    (row) => ({ sortValue: cursorValue(row.occurredAt), id: row.id }),
  )
}

export interface ReconciliationRow {
  readonly id: string
  readonly reference: string
  readonly customerName: string
  readonly bagTypeName: string | null
  readonly countedOn: string
  readonly status: string
  readonly expectedFull: number
  readonly expectedEmpty: number
  readonly countedFull: number
  readonly countedEmpty: number
  readonly varianceFull: number
  readonly varianceEmpty: number
  readonly damagedFound: number
  readonly varianceReason: string | null
  readonly customerRepName: string | null
}

export async function listReconciliations(
  tx: Tx,
  filters: {
    status?: string | undefined
    customerId?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<ReconciliationRow>> {
  const limit = listLimit(filters.limit)

  const rows = await rawRows(
    tx,
    sql`
      select
        r.id, r.reference, r.counted_on, r.status,
        r.expected_full, r.expected_empty, r.counted_full, r.counted_empty,
        r.variance_full, r.variance_empty, r.damaged_found, r.variance_reason,
        r.customer_rep_name, r.created_at,
        cu.legal_name as customer_name,
        bt.name_en    as bag_type_name
      from public.kesha_reconciliation r
      join public.customer cu on cu.id = r.customer_id
      left join public.bag_type bt on bt.id = r.bag_type_id
      where 1 = 1
        ${filters.status ? sql`and r.status = ${filters.status}` : sql``}
        ${filters.customerId ? sql`and r.customer_id = ${filters.customerId}::uuid` : sql``}
        ${keysetBefore(sql`r.created_at`, sql`r.id`, filters.cursor)}
      order by r.created_at desc, r.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(
    rows.map((row) => ({
      id: col.text(row.id),
      reference: col.text(row.reference),
      customerName: col.text(row.customer_name),
      bagTypeName: col.textOrNull(row.bag_type_name),
      countedOn: col.text(row.counted_on),
      status: col.text(row.status),
      expectedFull: col.int(row.expected_full),
      expectedEmpty: col.int(row.expected_empty),
      countedFull: col.int(row.counted_full),
      countedEmpty: col.int(row.counted_empty),
      varianceFull: col.int(row.variance_full),
      varianceEmpty: col.int(row.variance_empty),
      damagedFound: col.int(row.damaged_found),
      varianceReason: col.textOrNull(row.variance_reason),
      customerRepName: col.textOrNull(row.customer_rep_name),
      createdAt: col.date(row.created_at),
    })),
    limit,
    (row) => ({ sortValue: cursorValue(row.createdAt), id: row.id }),
  )
}

/** Headline totals for the kesha screen. */
export async function keshaTotals(
  tx: Tx,
): Promise<{ heldFull: number; heldEmpty: number; damaged: number; customers: number }> {
  const rows = await rawRows(
    tx,
    sql`
      select
        coalesce(sum(held_full), 0)::int  as held_full,
        coalesce(sum(held_empty), 0)::int as held_empty,
        coalesce(sum(damaged), 0)::int    as damaged,
        count(distinct customer_id)::int  as customers
      from public.kesha_balance
    `,
  )

  const row = rows[0]
  return {
    heldFull: row ? col.int(row.held_full) : 0,
    heldEmpty: row ? col.int(row.held_empty) : 0,
    damaged: row ? col.int(row.damaged) : 0,
    customers: row ? col.int(row.customers) : 0,
  }
}
