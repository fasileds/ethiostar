import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Goods Receiving Note (M06 §7.1).
 *
 * Assembled once, at print time, and stored verbatim in `printed_document.printed_snapshot` —
 * a later correction to the receipt must not silently change what a document that already
 * left the building says.
 */

export interface GoodsReceiptPrintLine {
  readonly lineNo: number
  readonly bagType: string | null
  readonly coffeeType: string | null
  readonly coffeeGrade: string | null
  readonly quantityKg: string
  readonly keshaCount: number
}

export interface GoodsReceiptSnapshot {
  readonly receiptId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchName: string
  readonly vehiclePlate: string | null
  readonly driverName: string | null
  readonly customerRepName: string | null
  readonly locationLabel: string | null
  readonly receivedQuantityKg: string
  readonly receivedKeshaCount: number
  readonly varianceKg: string | null
  readonly variancePct: string | null
  readonly occurredAt: Date
  readonly receivedByName: string | null
  readonly notes: string | null
  readonly lines: readonly GoodsReceiptPrintLine[]
}

export async function loadGoodsReceiptSnapshot(
  tx: Tx,
  receiptId: string,
): Promise<GoodsReceiptSnapshot | undefined> {
  const headerRows = await rawRows(
    tx,
    sql`
      select
        gr.id, gr.reference, gr.customer_id, cu.legal_name as customer_name,
        br.name_en as branch_name, gr.vehicle_plate, gr.driver_name, gr.customer_rep_name,
        gr.received_quantity_kg, gr.received_kesha_count, gr.variance_kg, gr.variance_pct,
        gr.occurred_at, gr.notes, u.full_name as received_by_name,
        wh.name_en as warehouse_name, rm.code as room_code, sec.code as section_code
      from public.goods_receipt gr
      join public.customer cu on cu.id = gr.customer_id
      join public.branch br on br.id = gr.branch_id
      left join public.app_user u on u.id = gr.received_by
      left join public.store_section sec on sec.id = gr.location_id
      left join public.store_room rm on rm.id = sec.room_id
      left join public.warehouse wh on wh.id = rm.warehouse_id
      where gr.id = ${receiptId}::uuid
      limit 1
    `,
  )

  const header = headerRows[0]
  if (!header) return undefined

  const lineRows = await rawRows(
    tx,
    sql`
      select
        gl.line_no, gl.quantity_kg, gl.kesha_count,
        bt.name_en as bag_type, ct.name_en as coffee_type, cg.name_en as coffee_grade
      from public.goods_receipt_line gl
      left join public.bag_type bt on bt.id = gl.bag_type_id
      left join public.coffee_type ct on ct.id = gl.coffee_type_id
      left join public.coffee_grade cg on cg.id = gl.coffee_grade_id
      where gl.receipt_id = ${receiptId}::uuid
      order by gl.line_no
    `,
  )

  const roomCode = col.textOrNull(header.room_code)
  const sectionCode = col.textOrNull(header.section_code)
  const warehouseName = col.textOrNull(header.warehouse_name)
  const locationLabel =
    warehouseName && roomCode && sectionCode
      ? `${warehouseName} / ${roomCode} / ${sectionCode}`
      : null

  return {
    receiptId: col.text(header.id),
    reference: col.text(header.reference),
    customerId: col.text(header.customer_id),
    customerName: col.text(header.customer_name),
    branchName: col.text(header.branch_name),
    vehiclePlate: col.textOrNull(header.vehicle_plate),
    driverName: col.textOrNull(header.driver_name),
    customerRepName: col.textOrNull(header.customer_rep_name),
    locationLabel,
    receivedQuantityKg: col.text(header.received_quantity_kg),
    receivedKeshaCount: col.int(header.received_kesha_count),
    varianceKg: col.textOrNull(header.variance_kg),
    variancePct: col.textOrNull(header.variance_pct),
    occurredAt: col.date(header.occurred_at),
    receivedByName: col.textOrNull(header.received_by_name),
    notes: col.textOrNull(header.notes),
    lines: lineRows.map((row) => ({
      lineNo: col.int(row.line_no),
      bagType: col.textOrNull(row.bag_type),
      coffeeType: col.textOrNull(row.coffee_type),
      coffeeGrade: col.textOrNull(row.coffee_grade),
      quantityKg: col.text(row.quantity_kg),
      keshaCount: col.int(row.kesha_count),
    })),
  }
}
