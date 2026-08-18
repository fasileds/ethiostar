import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Gate Pass (M17 §7.2, series GP).
 *
 * What the security officer checks against the truck at the gate: plate, driver, destination,
 * and the clearance verdict. Assembled once, at print time, and stored verbatim in
 * `printed_document.printed_snapshot` — a later edit to the dispatch order must not silently
 * change what a document that already left the building says.
 */

export interface GatePassSnapshot {
  readonly dispatchOrderId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchName: string
  readonly status: string
  readonly vehiclePlate: string | null
  readonly trailerPlate: string | null
  readonly driverName: string | null
  readonly driverIdNo: string | null
  readonly driverPhone: string | null
  readonly transporterName: string | null
  readonly destination: string | null
  readonly loadedQuantityKg: string | null
  readonly loadedKeshaCount: number | null
  readonly clearanceStatus: string | null
  readonly clearanceNote: string | null
  readonly clearanceCheckedAt: Date | null
  readonly clearanceCheckedByName: string | null
  readonly gateOutAt: Date | null
}

export async function loadGatePassSnapshot(
  tx: Tx,
  dispatchOrderId: string,
): Promise<GatePassSnapshot | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        d.id, d.reference, d.customer_id, cu.legal_name as customer_name,
        br.name_en as branch_name, d.status,
        d.vehicle_plate, d.trailer_plate, d.driver_name, d.driver_id_no, d.driver_phone,
        d.transporter_name, d.destination,
        d.loaded_quantity_kg, d.loaded_kesha_count,
        d.clearance_status, d.clearance_note, d.clearance_checked_at,
        au.full_name as clearance_checked_by_name, d.gate_out_at
      from public.dispatch_order d
      join public.customer cu on cu.id = d.customer_id
      join public.branch br on br.id = d.branch_id
      left join public.app_user au on au.id = d.clearance_checked_by
      where d.id = ${dispatchOrderId}::uuid
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    dispatchOrderId: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    branchName: col.text(row.branch_name),
    status: col.text(row.status),
    vehiclePlate: col.textOrNull(row.vehicle_plate),
    trailerPlate: col.textOrNull(row.trailer_plate),
    driverName: col.textOrNull(row.driver_name),
    driverIdNo: col.textOrNull(row.driver_id_no),
    driverPhone: col.textOrNull(row.driver_phone),
    transporterName: col.textOrNull(row.transporter_name),
    destination: col.textOrNull(row.destination),
    loadedQuantityKg: col.numericOrNull(row.loaded_quantity_kg),
    loadedKeshaCount: col.intOrNull(row.loaded_kesha_count),
    clearanceStatus: col.textOrNull(row.clearance_status),
    clearanceNote: col.textOrNull(row.clearance_note),
    clearanceCheckedAt: col.dateOrNull(row.clearance_checked_at),
    clearanceCheckedByName: col.textOrNull(row.clearance_checked_by_name),
    gateOutAt: col.dateOrNull(row.gate_out_at),
  }
}
