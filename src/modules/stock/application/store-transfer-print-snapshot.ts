import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Store Transfer Note (M06 §7.x, series ST).
 *
 * `stock_transfer` is only the header; the actual quantity moved is read off the
 * `TRANSFER_IN` ledger row it produced, so the document always states what was posted, not
 * what was merely requested.
 */

export interface StoreTransferSnapshot {
  readonly transferId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchName: string
  readonly lotReference: string
  readonly coffeeType: string | null
  readonly coffeeGrade: string | null
  readonly bagType: string | null
  readonly quantityKg: string
  readonly keshaCount: number
  readonly fromLocationLabel: string
  readonly toLocationLabel: string
  readonly reasonName: string | null
  readonly narrative: string | null
  readonly occurredAt: Date
  readonly authorisedByName: string | null
}

export async function loadStoreTransferSnapshot(
  tx: Tx,
  transferId: string,
): Promise<StoreTransferSnapshot | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        st.id, st.reference, st.occurred_at, st.narrative,
        m.quantity_kg, m.kesha_count, m.lot_id, m.bag_type_id, m.customer_id,
        cu.legal_name as customer_name, br.name_en as branch_name,
        l.reference as lot_reference,
        ct.name_en as coffee_type, cg.name_en as coffee_grade, bt.name_en as bag_type,
        rc.name_en as reason_name, u.full_name as authorised_by_name,
        from_wh.name_en as from_warehouse_name, from_rm.code as from_room_code,
        from_sec.code as from_section_code,
        to_wh.name_en as to_warehouse_name, to_rm.code as to_room_code,
        to_sec.code as to_section_code
      from public.stock_transfer st
      join public.stock_movement m
        on m.source_type = 'stock_transfer' and m.source_id = st.id and m.movement_type = 'TRANSFER_IN'
      join public.lot l on l.id = m.lot_id
      join public.customer cu on cu.id = m.customer_id
      join public.consignment co on co.id = m.consignment_id
      join public.branch br on br.id = co.branch_id
      left join public.coffee_type ct on ct.id = l.coffee_type_id
      left join public.coffee_grade cg on cg.id = l.coffee_grade_id
      left join public.bag_type bt on bt.id = m.bag_type_id
      left join public.reason_code rc on rc.id = st.reason_code_id
      left join public.app_user u on u.id = st.created_by
      join public.store_section from_sec on from_sec.id = st.from_location_id
      join public.store_room from_rm on from_rm.id = from_sec.room_id
      join public.warehouse from_wh on from_wh.id = from_rm.warehouse_id
      join public.store_section to_sec on to_sec.id = st.to_location_id
      join public.store_room to_rm on to_rm.id = to_sec.room_id
      join public.warehouse to_wh on to_wh.id = to_rm.warehouse_id
      where st.id = ${transferId}::uuid
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    transferId: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    branchName: col.text(row.branch_name),
    lotReference: col.text(row.lot_reference),
    coffeeType: col.textOrNull(row.coffee_type),
    coffeeGrade: col.textOrNull(row.coffee_grade),
    bagType: col.textOrNull(row.bag_type),
    quantityKg: col.numeric(row.quantity_kg),
    keshaCount: col.int(row.kesha_count),
    fromLocationLabel: `${col.text(row.from_warehouse_name)} / ${col.text(row.from_room_code)} / ${col.text(row.from_section_code)}`,
    toLocationLabel: `${col.text(row.to_warehouse_name)} / ${col.text(row.to_room_code)} / ${col.text(row.to_section_code)}`,
    reasonName: col.textOrNull(row.reason_name),
    narrative: col.textOrNull(row.narrative),
    occurredAt: col.date(row.occurred_at),
    authorisedByName: col.textOrNull(row.authorised_by_name),
  }
}
