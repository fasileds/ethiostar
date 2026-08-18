import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Stock Adjustment (M06 §7.x, series ADJ).
 *
 * `stock_adjustment` stores only the signed delta; "before" is derived from the ledger sum
 * of every movement on the same (lot, location) strictly prior to the movement this
 * adjustment posted, and "after" is that sum plus the delta — so the document states the
 * balance as it stood at the moment of the adjustment, not today's balance.
 */

export interface StockAdjustmentSnapshot {
  readonly adjustmentId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchName: string
  readonly lotReference: string
  readonly coffeeType: string | null
  readonly coffeeGrade: string | null
  readonly bagType: string | null
  readonly locationLabel: string
  readonly quantityKgDelta: string
  readonly keshaCountDelta: number
  readonly beforeQuantityKg: string
  readonly beforeKeshaCount: number
  readonly afterQuantityKg: string
  readonly afterKeshaCount: number
  readonly reasonName: string
  readonly narrative: string | null
  readonly occurredAt: Date
  readonly createdByName: string | null
  readonly approvedByName: string | null
  readonly approvedAt: Date | null
}

export async function loadStockAdjustmentSnapshot(
  tx: Tx,
  adjustmentId: string,
): Promise<StockAdjustmentSnapshot | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      with adj as (
        select
          a.id, a.reference, a.lot_id, a.location_id, a.quantity_kg_delta, a.kesha_count_delta,
          a.reason_code_id, a.narrative, a.occurred_at, a.approved_by, a.approved_at, a.created_by,
          m.id as movement_id, m.recorded_at as movement_recorded_at,
          m.customer_id, m.consignment_id, m.bag_type_id
        from public.stock_adjustment a
        join public.stock_movement m
          on m.source_type = 'stock_adjustment' and m.source_id = a.id
        where a.id = ${adjustmentId}::uuid
      )
      select
        adj.id, adj.reference, adj.customer_id, adj.quantity_kg_delta, adj.kesha_count_delta,
        adj.narrative, adj.occurred_at, adj.approved_at,
        cu.legal_name as customer_name, br.name_en as branch_name,
        l.reference as lot_reference,
        ct.name_en as coffee_type, cg.name_en as coffee_grade, bt.name_en as bag_type,
        rc.name_en as reason_name,
        creator.full_name as created_by_name, appr.full_name as approved_by_name,
        wh.name_en as warehouse_name, rm.code as room_code, sec.code as section_code,
        coalesce(prior.before_kg, 0) as before_kg,
        coalesce(prior.before_kesha, 0) as before_kesha,
        coalesce(prior.before_kg, 0) + adj.quantity_kg_delta as after_kg,
        coalesce(prior.before_kesha, 0) + adj.kesha_count_delta as after_kesha
      from adj
      join public.lot l on l.id = adj.lot_id
      join public.customer cu on cu.id = adj.customer_id
      join public.consignment co on co.id = adj.consignment_id
      join public.branch br on br.id = co.branch_id
      left join public.coffee_type ct on ct.id = l.coffee_type_id
      left join public.coffee_grade cg on cg.id = l.coffee_grade_id
      left join public.bag_type bt on bt.id = adj.bag_type_id
      join public.reason_code rc on rc.id = adj.reason_code_id
      left join public.app_user creator on creator.id = adj.created_by
      left join public.app_user appr on appr.id = adj.approved_by
      join public.store_section sec on sec.id = adj.location_id
      join public.store_room rm on rm.id = sec.room_id
      join public.warehouse wh on wh.id = rm.warehouse_id
      left join lateral (
        select sum(m2.quantity_kg) as before_kg, sum(m2.kesha_count) as before_kesha
        from public.stock_movement m2
        where m2.lot_id = adj.lot_id and m2.location_id = adj.location_id
          and (m2.recorded_at, m2.id) < (adj.movement_recorded_at, adj.movement_id)
      ) prior on true
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    adjustmentId: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    branchName: col.text(row.branch_name),
    lotReference: col.text(row.lot_reference),
    coffeeType: col.textOrNull(row.coffee_type),
    coffeeGrade: col.textOrNull(row.coffee_grade),
    bagType: col.textOrNull(row.bag_type),
    locationLabel: `${col.text(row.warehouse_name)} / ${col.text(row.room_code)} / ${col.text(row.section_code)}`,
    quantityKgDelta: col.numeric(row.quantity_kg_delta),
    keshaCountDelta: col.int(row.kesha_count_delta),
    beforeQuantityKg: col.numeric(row.before_kg),
    beforeKeshaCount: col.int(row.before_kesha),
    afterQuantityKg: col.numeric(row.after_kg),
    afterKeshaCount: col.int(row.after_kesha),
    reasonName: col.text(row.reason_name),
    narrative: col.textOrNull(row.narrative),
    occurredAt: col.date(row.occurred_at),
    createdByName: col.textOrNull(row.created_by_name),
    approvedByName: col.textOrNull(row.approved_by_name),
    approvedAt: col.dateOrNull(row.approved_at),
  }
}
