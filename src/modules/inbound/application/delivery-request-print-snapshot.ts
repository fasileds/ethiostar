import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Delivery Request Acknowledgement (M06 §7.1, M11).
 *
 * Assembled once, at print time, and stored verbatim in `printed_document.printed_snapshot` —
 * a later correction to the request must not silently change what a document that already
 * left the building says.
 */

export interface DeliveryRequestSnapshot {
  readonly requestId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchName: string
  readonly status: string
  readonly coffeeTypeName: string | null
  readonly coffeeGradeName: string | null
  readonly declaredQuantityKg: string
  readonly declaredKeshaCount: number
  readonly expectedArrivalOn: string
  readonly expectedArrivalWindow: string | null
  readonly transportMode: string | null
  readonly vehiclePlate: string | null
  readonly driverName: string | null
  readonly driverPhone: string | null
  readonly approvedByName: string | null
  readonly approvedAt: Date | null
  readonly rejectionReason: string | null
  readonly notes: string | null
  readonly createdAt: Date
}

export async function loadDeliveryRequestSnapshot(
  tx: Tx,
  requestId: string,
): Promise<DeliveryRequestSnapshot | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        r.id, r.reference, r.customer_id, cu.legal_name as customer_name,
        br.name_en as branch_name, r.status,
        ct.name_en as coffee_type_name, cg.name_en as coffee_grade_name,
        r.declared_quantity_kg, r.declared_kesha_count,
        r.expected_arrival_on, r.expected_arrival_window, r.transport_mode,
        r.vehicle_plate, r.driver_name, r.driver_phone,
        u.full_name as approved_by_name, r.approved_at, r.rejection_reason,
        r.notes, r.created_at
      from public.delivery_request r
      join public.customer cu on cu.id = r.customer_id
      join public.branch br on br.id = r.branch_id
      left join public.coffee_type ct on ct.id = r.coffee_type_id
      left join public.coffee_grade cg on cg.id = r.coffee_grade_id
      left join public.app_user u on u.id = r.approved_by
      where r.id = ${requestId}::uuid
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    requestId: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    branchName: col.text(row.branch_name),
    status: col.text(row.status),
    coffeeTypeName: col.textOrNull(row.coffee_type_name),
    coffeeGradeName: col.textOrNull(row.coffee_grade_name),
    declaredQuantityKg: col.numeric(row.declared_quantity_kg),
    declaredKeshaCount: col.int(row.declared_kesha_count),
    expectedArrivalOn: col.text(row.expected_arrival_on),
    expectedArrivalWindow: col.textOrNull(row.expected_arrival_window),
    transportMode: col.textOrNull(row.transport_mode),
    vehiclePlate: col.textOrNull(row.vehicle_plate),
    driverName: col.textOrNull(row.driver_name),
    driverPhone: col.textOrNull(row.driver_phone),
    approvedByName: col.textOrNull(row.approved_by_name),
    approvedAt: col.dateOrNull(row.approved_at),
    rejectionReason: col.textOrNull(row.rejection_reason),
    notes: col.textOrNull(row.notes),
    createdAt: col.date(row.created_at),
  }
}
