import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Store Placement Slip (M06 §7.1, M12).
 *
 * `lot_placement` has no id of its own — `(lot_id, location_id)` is the primary key, and a
 * lot has at most one current placement row at a time — so the loader is keyed on the LOT,
 * not on a placement id. Assembled once, at print time, and stored verbatim in
 * `printed_document.printed_snapshot` — a later transfer must not silently change what a slip
 * that already left the building says.
 */

export interface StorePlacementSnapshot {
  readonly lotId: string
  readonly lotReference: string
  readonly consignmentId: string
  readonly consignmentReference: string
  readonly customerId: string
  readonly customerName: string
  readonly coffeeTypeName: string | null
  readonly coffeeGradeName: string | null
  readonly bagTypeName: string | null
  readonly quantityKg: string
  readonly keshaCount: number
  readonly locationLabel: string
  readonly placedAt: Date
  readonly placedByName: string | null
}

export async function loadStorePlacementSnapshot(
  tx: Tx,
  lotId: string,
): Promise<StorePlacementSnapshot | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        l.id, l.reference, l.consignment_id, cons.reference as consignment_reference,
        l.customer_id, cu.legal_name as customer_name,
        ct.name_en as coffee_type_name, cg.name_en as coffee_grade_name,
        bt.name_en as bag_type_name,
        l.initial_quantity_kg, l.initial_kesha_count,
        wh.name_en as warehouse_name, rm.code as room_code, sec.code as section_code,
        lp.placed_at, u.full_name as placed_by_name
      from public.lot l
      join public.consignment cons on cons.id = l.consignment_id
      join public.customer cu on cu.id = l.customer_id
      left join public.coffee_type ct on ct.id = l.coffee_type_id
      left join public.coffee_grade cg on cg.id = l.coffee_grade_id
      left join public.bag_type bt on bt.id = l.bag_type_id
      join public.lot_placement lp on lp.lot_id = l.id
      join public.store_section sec on sec.id = lp.location_id
      join public.store_room rm on rm.id = sec.room_id
      join public.warehouse wh on wh.id = rm.warehouse_id
      left join public.app_user u on u.id = lp.created_by
      where l.id = ${lotId}::uuid
      order by lp.placed_at desc
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  const warehouseName = col.text(row.warehouse_name)
  const roomCode = col.text(row.room_code)
  const sectionCode = col.text(row.section_code)

  return {
    lotId: col.text(row.id),
    lotReference: col.text(row.reference),
    consignmentId: col.text(row.consignment_id),
    consignmentReference: col.text(row.consignment_reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    coffeeTypeName: col.textOrNull(row.coffee_type_name),
    coffeeGradeName: col.textOrNull(row.coffee_grade_name),
    bagTypeName: col.textOrNull(row.bag_type_name),
    quantityKg: col.numeric(row.initial_quantity_kg),
    keshaCount: col.int(row.initial_kesha_count),
    locationLabel: `${warehouseName} / ${roomCode} / ${sectionCode}`,
    placedAt: col.date(row.placed_at),
    placedByName: col.textOrNull(row.placed_by_name),
  }
}
