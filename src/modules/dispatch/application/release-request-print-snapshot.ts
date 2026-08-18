import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Release Request Acknowledgement (M17 §7.2, series RR).
 *
 * Assembled once, at print time, and stored verbatim in `printed_document.printed_snapshot` —
 * a later edit to the request must not silently change what a document that already left the
 * building says.
 */

export interface ReleaseRequestSnapshot {
  readonly requestId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchName: string
  readonly consignmentReference: string | null
  readonly status: string
  readonly requestedQuantityKg: string
  readonly requestedKeshaCount: number | null
  readonly requestedCollectionOn: string | null
  readonly authorisedByName: string | null
  readonly collectorName: string | null
  readonly collectorIdNo: string | null
  readonly collectorPhone: string | null
  readonly vehiclePlate: string | null
  readonly submittedAt: Date | null
  readonly approvedByName: string | null
  readonly approvedAt: Date | null
  readonly notes: string | null
}

export async function loadReleaseRequestSnapshot(
  tx: Tx,
  requestId: string,
): Promise<ReleaseRequestSnapshot | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        r.id, r.reference, r.customer_id, cu.legal_name as customer_name,
        br.name_en as branch_name, cons.reference as consignment_reference,
        r.status, r.requested_quantity_kg, r.requested_kesha_count, r.requested_collection_on,
        cc.full_name as authorised_by_name,
        r.collector_name, r.collector_id_no, r.collector_phone, r.vehicle_plate,
        r.submitted_at, r.approved_at, au.full_name as approved_by_name, r.notes
      from public.release_request r
      join public.customer cu on cu.id = r.customer_id
      join public.branch br on br.id = r.branch_id
      left join public.consignment cons on cons.id = r.consignment_id
      left join public.customer_contact cc on cc.id = r.authorised_by_contact_id
      left join public.app_user au on au.id = r.approved_by
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
    consignmentReference: col.textOrNull(row.consignment_reference),
    status: col.text(row.status),
    requestedQuantityKg: col.numeric(row.requested_quantity_kg),
    requestedKeshaCount: col.intOrNull(row.requested_kesha_count),
    requestedCollectionOn: col.textOrNull(row.requested_collection_on),
    authorisedByName: col.textOrNull(row.authorised_by_name),
    collectorName: col.textOrNull(row.collector_name),
    collectorIdNo: col.textOrNull(row.collector_id_no),
    collectorPhone: col.textOrNull(row.collector_phone),
    vehiclePlate: col.textOrNull(row.vehicle_plate),
    submittedAt: col.dateOrNull(row.submitted_at),
    approvedByName: col.textOrNull(row.approved_by_name),
    approvedAt: col.dateOrNull(row.approved_at),
    notes: col.textOrNull(row.notes),
  }
}
