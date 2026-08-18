import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Processing Request (M06 §7.x, M15).
 *
 * Assembled once, at print time, and stored verbatim in `printed_document.printed_snapshot` —
 * a later edit to the request must not silently change what a document that already left the
 * building says.
 */

export interface ProcessingRequestSnapshot {
  readonly requestId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchName: string
  readonly consignmentReference: string | null
  readonly status: string
  readonly serviceType: string
  readonly requestedQuantityKg: string
  readonly requestedKeshaCount: number | null
  readonly outputSpecification: string | null
  readonly preferredStartOn: string | null
  readonly urgency: string
  readonly submittedAt: Date | null
  readonly approvedByName: string | null
  readonly approvedAt: Date | null
  readonly notes: string | null
  readonly createdAt: Date
}

export async function loadProcessingRequestSnapshot(
  tx: Tx,
  requestId: string,
): Promise<ProcessingRequestSnapshot | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        p.id, p.reference, p.customer_id, cu.legal_name as customer_name,
        br.name_en as branch_name, cons.reference as consignment_reference,
        p.status, p.service_type, p.requested_quantity_kg, p.requested_kesha_count,
        p.output_specification, p.preferred_start_on, p.urgency,
        p.submitted_at, p.approved_at, ap.full_name as approved_by_name,
        p.notes, p.created_at
      from public.processing_request p
      join public.customer cu on cu.id = p.customer_id
      join public.branch br on br.id = p.branch_id
      left join public.consignment cons on cons.id = p.consignment_id
      left join public.app_user ap on ap.id = p.approved_by
      where p.id = ${requestId}::uuid
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
    serviceType: col.text(row.service_type),
    requestedQuantityKg: col.numeric(row.requested_quantity_kg),
    requestedKeshaCount: col.intOrNull(row.requested_kesha_count),
    outputSpecification: col.textOrNull(row.output_specification),
    preferredStartOn: col.textOrNull(row.preferred_start_on),
    urgency: col.text(row.urgency),
    submittedAt: col.dateOrNull(row.submitted_at),
    approvedByName: col.textOrNull(row.approved_by_name),
    approvedAt: col.dateOrNull(row.approved_at),
    notes: col.textOrNull(row.notes),
    createdAt: col.date(row.created_at),
  }
}
