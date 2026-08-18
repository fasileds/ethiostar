import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Loading List (M17 §7.2, series LL).
 *
 * The picking list handed to the store crew: what to load, lot by lot. Assembled once, at
 * print time, and stored verbatim in `printed_document.printed_snapshot` — a later edit to
 * the dispatch order must not silently change what a document that already left the building
 * says.
 */

export interface LoadingListLine {
  readonly lineNo: number
  readonly lotReference: string
  readonly coffeeType: string | null
  readonly coffeeGrade: string | null
  readonly bagType: string | null
  readonly locationCode: string | null
  readonly quantityKg: string
  readonly keshaCount: number
}

export interface LoadingListSnapshot {
  readonly dispatchOrderId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchName: string
  readonly status: string
  readonly vehiclePlate: string | null
  readonly trailerPlate: string | null
  readonly driverName: string | null
  readonly transporterName: string | null
  readonly destination: string | null
  readonly plannedQuantityKg: string
  readonly plannedKeshaCount: number | null
  readonly loadingStartedAt: Date | null
  readonly notes: string | null
  readonly lines: readonly LoadingListLine[]
}

export async function loadLoadingListSnapshot(
  tx: Tx,
  dispatchOrderId: string,
): Promise<LoadingListSnapshot | undefined> {
  const headerRows = await rawRows(
    tx,
    sql`
      select
        d.id, d.reference, d.customer_id, cu.legal_name as customer_name,
        br.name_en as branch_name, d.status,
        d.vehicle_plate, d.trailer_plate, d.driver_name, d.transporter_name, d.destination,
        d.planned_quantity_kg, d.planned_kesha_count, d.loading_started_at, d.notes
      from public.dispatch_order d
      join public.customer cu on cu.id = d.customer_id
      join public.branch br on br.id = d.branch_id
      where d.id = ${dispatchOrderId}::uuid
      limit 1
    `,
  )

  const header = headerRows[0]
  if (!header) return undefined

  const lineRows = await rawRows(
    tx,
    sql`
      select
        dl.line_no, dl.quantity_kg, dl.kesha_count,
        l.reference as lot_reference,
        ct.name_en as coffee_type, cg.name_en as coffee_grade,
        bt.name_en as bag_type, s.code as location_code
      from public.dispatch_line dl
      join public.lot l on l.id = dl.lot_id
      left join public.coffee_type ct on ct.id = l.coffee_type_id
      left join public.coffee_grade cg on cg.id = l.coffee_grade_id
      left join public.bag_type bt on bt.id = dl.bag_type_id
      left join public.store_section s on s.id = dl.location_id
      where dl.dispatch_order_id = ${dispatchOrderId}::uuid
      order by dl.line_no
    `,
  )

  return {
    dispatchOrderId: col.text(header.id),
    reference: col.text(header.reference),
    customerId: col.text(header.customer_id),
    customerName: col.text(header.customer_name),
    branchName: col.text(header.branch_name),
    status: col.text(header.status),
    vehiclePlate: col.textOrNull(header.vehicle_plate),
    trailerPlate: col.textOrNull(header.trailer_plate),
    driverName: col.textOrNull(header.driver_name),
    transporterName: col.textOrNull(header.transporter_name),
    destination: col.textOrNull(header.destination),
    plannedQuantityKg: col.numeric(header.planned_quantity_kg),
    plannedKeshaCount: col.intOrNull(header.planned_kesha_count),
    loadingStartedAt: col.dateOrNull(header.loading_started_at),
    notes: col.textOrNull(header.notes),
    lines: lineRows.map((row) => ({
      lineNo: col.int(row.line_no),
      lotReference: col.text(row.lot_reference),
      coffeeType: col.textOrNull(row.coffee_type),
      coffeeGrade: col.textOrNull(row.coffee_grade),
      bagType: col.textOrNull(row.bag_type),
      locationCode: col.textOrNull(row.location_code),
      quantityKg: col.numeric(row.quantity_kg),
      keshaCount: col.int(row.kesha_count),
    })),
  }
}
