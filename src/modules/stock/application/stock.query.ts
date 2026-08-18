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
 * Stock read models.
 *
 * On-hand comes from `stock_balance`, the projection. The LEDGER (`stock_movement`) remains
 * the source of truth — the balance is rebuildable from it, and the reconcile function exists
 * precisely so "does the projection still agree with the ledger" is a question with an answer.
 *
 * Movement history is keyset-paginated without exception. `stock_movement` is partitioned and
 * grows without bound; OFFSET on it is a lint error, not a style preference.
 */

export interface StockOnHandRow {
  readonly lotId: string
  readonly lotReference: string
  readonly consignmentId: string
  readonly consignmentReference: string
  readonly customerId: string
  readonly customerName: string
  readonly locationId: string
  readonly sectionCode: string
  readonly roomCode: string
  readonly warehouseCode: string
  readonly quantityKg: string
  readonly keshaCount: number
  readonly lotStatus: string
  readonly coffeeTypeName: string | null
  readonly updatedAt: Date
}

export interface StockFilters {
  readonly search?: string | undefined
  readonly customerId?: string | undefined
  readonly locationId?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

export async function listStockOnHand(
  tx: Tx,
  filters: StockFilters = {},
): Promise<ListPage<StockOnHandRow>> {
  const limit = listLimit(filters.limit)
  const search = filters.search?.trim()

  const rows = await rawRows(
    tx,
    sql`
      select
        b.lot_id, b.consignment_id, b.customer_id, b.location_id,
        b.quantity_kg, b.kesha_count, b.updated_at,
        l.reference as lot_reference, l.status as lot_status,
        cons.reference as consignment_reference,
        cu.legal_name  as customer_name,
        s.code  as section_code,
        rm.code as room_code,
        wh.code as warehouse_code,
        ct.name_en as coffee_type_name
      from public.stock_balance b
      join public.lot l          on l.id = b.lot_id
      join public.consignment cons on cons.id = b.consignment_id
      join public.customer cu    on cu.id = b.customer_id
      join public.store_section s on s.id = b.location_id
      join public.store_room rm  on rm.id = s.room_id
      join public.warehouse wh   on wh.id = rm.warehouse_id
      left join public.coffee_type ct on ct.id = l.coffee_type_id
      where b.quantity_kg > 0
        ${filters.customerId ? sql`and b.customer_id = ${filters.customerId}::uuid` : sql``}
        ${filters.locationId ? sql`and b.location_id = ${filters.locationId}::uuid` : sql``}
        ${
          search
            ? sql`and (l.reference ilike ${'%' + search + '%'}
                    or cons.reference ilike ${'%' + search + '%'}
                    or cu.legal_name ilike ${'%' + search + '%'}
                    or s.code ilike ${'%' + search + '%'})`
            : sql``
        }
        ${keysetBefore(sql`b.updated_at`, sql`b.lot_id`, filters.cursor)}
      order by b.updated_at desc, b.lot_id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(
    rows.map((row): StockOnHandRow => ({
      lotId: col.text(row.lot_id),
      lotReference: col.text(row.lot_reference),
      consignmentId: col.text(row.consignment_id),
      consignmentReference: col.text(row.consignment_reference),
      customerId: col.text(row.customer_id),
      customerName: col.text(row.customer_name),
      locationId: col.text(row.location_id),
      sectionCode: col.text(row.section_code),
      roomCode: col.text(row.room_code),
      warehouseCode: col.text(row.warehouse_code),
      quantityKg: col.numeric(row.quantity_kg),
      keshaCount: col.int(row.kesha_count),
      lotStatus: col.text(row.lot_status),
      coffeeTypeName: col.textOrNull(row.coffee_type_name),
      updatedAt: col.date(row.updated_at),
    })),
    limit,
    (row) => ({ sortValue: cursorValue(row.updatedAt), id: row.lotId }),
  )
}

export interface MovementRow {
  readonly id: string
  readonly occurredAt: Date
  readonly movementType: string
  readonly direction: string
  readonly quantityKg: string
  readonly keshaCount: number | null
  readonly lotReference: string | null
  readonly consignmentReference: string | null
  readonly customerName: string | null
  readonly sectionCode: string | null
  readonly sourceType: string
  readonly reasonCode: string | null
  readonly actorName: string | null
}

export async function listMovements(
  tx: Tx,
  filters: {
    lotId?: string | undefined
    consignmentId?: string | undefined
    customerId?: string | undefined
    movementType?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<MovementRow>> {
  const limit = listLimit(filters.limit)

  const rows = await rawRows(
    tx,
    sql`
      select
        m.id, m.occurred_at, m.movement_type, m.quantity_kg, m.kesha_count,
        m.source_type, m.reason_code,
        case when m.quantity_kg < 0 then 'OUT' else 'IN' end as direction,
        l.reference    as lot_reference,
        cons.reference as consignment_reference,
        cu.legal_name  as customer_name,
        s.code         as section_code,
        u.full_name    as actor_name
      from public.stock_movement m
      left join public.lot l           on l.id = m.lot_id
      left join public.consignment cons on cons.id = m.consignment_id
      left join public.customer cu     on cu.id = m.customer_id
      left join public.store_section s on s.id = m.location_id
      left join public.app_user u      on u.id = m.created_by
      where 1 = 1
        ${filters.lotId ? sql`and m.lot_id = ${filters.lotId}::uuid` : sql``}
        ${filters.consignmentId ? sql`and m.consignment_id = ${filters.consignmentId}::uuid` : sql``}
        ${filters.customerId ? sql`and m.customer_id = ${filters.customerId}::uuid` : sql``}
        ${filters.movementType ? sql`and m.movement_type = ${filters.movementType}` : sql``}
        ${keysetBefore(sql`m.occurred_at`, sql`m.id`, filters.cursor)}
      order by m.occurred_at desc, m.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(
    rows.map((row): MovementRow => ({
      id: col.text(row.id),
      occurredAt: col.date(row.occurred_at),
      movementType: col.text(row.movement_type),
      direction: col.text(row.direction),
      quantityKg: col.numeric(row.quantity_kg),
      keshaCount: col.intOrNull(row.kesha_count),
      lotReference: col.textOrNull(row.lot_reference),
      consignmentReference: col.textOrNull(row.consignment_reference),
      customerName: col.textOrNull(row.customer_name),
      sectionCode: col.textOrNull(row.section_code),
      sourceType: col.text(row.source_type),
      reasonCode: col.textOrNull(row.reason_code),
      actorName: col.textOrNull(row.actor_name),
    })),
    limit,
    (row) => ({ sortValue: cursorValue(row.occurredAt), id: row.id }),
  )
}

/** Totals by customer — the "who is holding what" view finance and operations both ask for. */
export interface CustomerStockSummary {
  readonly customerId: string
  readonly customerName: string
  readonly quantityKg: string
  readonly keshaCount: number
  readonly lots: number
  readonly consignments: number
}

export async function stockByCustomer(tx: Tx, limit = 50): Promise<CustomerStockSummary[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        b.customer_id, cu.legal_name as customer_name,
        sum(b.quantity_kg)                    as quantity_kg,
        sum(b.kesha_count)::int               as kesha_count,
        count(distinct b.lot_id)::int         as lots,
        count(distinct b.consignment_id)::int as consignments
      from public.stock_balance b
      join public.customer cu on cu.id = b.customer_id
      where b.quantity_kg > 0
      group by b.customer_id, cu.legal_name
      order by sum(b.quantity_kg) desc
      limit ${limit}
    `,
  )

  return rows.map((row) => ({
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    quantityKg: col.numeric(row.quantity_kg),
    keshaCount: col.int(row.kesha_count),
    lots: col.int(row.lots),
    consignments: col.int(row.consignments),
  }))
}

/**
 * Ledger-versus-projection reconciliation.
 *
 * Sums the ledger per (lot, location) and compares it to `stock_balance`. Any row returned
 * is a discrepancy — the projection drifting from its source — and an empty result is the
 * assertion that the two agree. This is the query behind the M12 integrity check.
 */
export interface ReconciliationVariance {
  readonly lotId: string
  readonly lotReference: string
  readonly locationId: string
  readonly sectionCode: string
  readonly ledgerKg: string
  readonly balanceKg: string
  readonly differenceKg: string
}

export async function reconciliationVariances(tx: Tx): Promise<ReconciliationVariance[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        led.lot_id, led.location_id,
        l.reference as lot_reference,
        s.code      as section_code,
        led.ledger_kg,
        coalesce(b.quantity_kg, 0) as balance_kg,
        (led.ledger_kg - coalesce(b.quantity_kg, 0)) as difference_kg
      from (
        select lot_id, location_id, sum(quantity_kg) as ledger_kg
        from public.stock_movement
        group by lot_id, location_id
      ) led
      left join public.stock_balance b
        on b.lot_id = led.lot_id and b.location_id = led.location_id
      join public.lot l           on l.id = led.lot_id
      join public.store_section s on s.id = led.location_id
      where led.ledger_kg <> coalesce(b.quantity_kg, 0)
      order by abs(led.ledger_kg - coalesce(b.quantity_kg, 0)) desc
      limit 100
    `,
  )

  return rows.map((row) => ({
    lotId: col.text(row.lot_id),
    lotReference: col.text(row.lot_reference),
    locationId: col.text(row.location_id),
    sectionCode: col.text(row.section_code),
    ledgerKg: col.numeric(row.ledger_kg),
    balanceKg: col.numeric(row.balance_kg),
    differenceKg: col.numeric(row.difference_kg),
  }))
}
