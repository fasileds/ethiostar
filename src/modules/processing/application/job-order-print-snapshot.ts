import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Job Order (M06 §7.x, M15) — the operator's instruction to
 * run a job.
 *
 * Assembled once, at print time, and stored verbatim in `printed_document.printed_snapshot` —
 * a later edit to the job must not silently change what a document that already left the
 * building says.
 */

export interface JobOrderPrintInputLine {
  readonly lineNo: number
  readonly lotReference: string
  readonly coffeeType: string | null
  readonly coffeeGrade: string | null
  readonly quantityKg: string
  readonly keshaCount: number | null
}

export interface JobOrderPrintExpectedOutput {
  readonly classificationName: string
  readonly expectedYieldPct: string | null
}

export interface JobOrderSnapshot {
  readonly jobOrderId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchName: string
  readonly consignmentReference: string
  readonly processingRequestReference: string | null
  readonly status: string
  readonly serviceType: string
  readonly machineName: string | null
  readonly plannedInputKg: string
  readonly plannedKeshaCount: number | null
  readonly scheduledStartAt: Date | null
  readonly supervisorName: string | null
  readonly notes: string | null
  readonly createdAt: Date
  readonly inputs: readonly JobOrderPrintInputLine[]
  readonly expectedOutputs: readonly JobOrderPrintExpectedOutput[]
}

export async function loadJobOrderSnapshot(
  tx: Tx,
  jobOrderId: string,
): Promise<JobOrderSnapshot | undefined> {
  const headerRows = await rawRows(
    tx,
    sql`
      select
        j.id, j.reference, j.customer_id, cu.legal_name as customer_name,
        br.name_en as branch_name, cons.reference as consignment_reference,
        pr.reference as processing_request_reference,
        j.status, j.service_type, m.name_en as machine_name,
        j.planned_input_kg, j.planned_kesha_count, j.scheduled_start_at,
        sup.full_name as supervisor_name, j.notes, j.created_at
      from public.job_order j
      join public.customer cu on cu.id = j.customer_id
      join public.branch br on br.id = j.branch_id
      join public.consignment cons on cons.id = j.consignment_id
      left join public.processing_request pr on pr.id = j.processing_request_id
      left join public.machine m on m.id = j.machine_id
      left join public.app_user sup on sup.id = j.supervisor_id
      where j.id = ${jobOrderId}::uuid
      limit 1
    `,
  )

  const header = headerRows[0]
  if (!header) return undefined

  const inputRows = await rawRows(
    tx,
    sql`
      select
        i.line_no, i.quantity_kg, i.kesha_count,
        l.reference as lot_reference,
        ct.name_en as coffee_type, cg.name_en as coffee_grade
      from public.job_order_input i
      join public.lot l on l.id = i.lot_id
      left join public.coffee_type ct on ct.id = i.coffee_type_id
      left join public.coffee_grade cg on cg.id = i.coffee_grade_id
      where i.job_order_id = ${jobOrderId}::uuid
      order by i.line_no
    `,
  )

  const expectedOutputRows = await rawRows(
    tx,
    sql`
      select name_en as classification_name, expected_yield_pct
      from public.output_classification
      where is_active
      order by sort_order
    `,
  )

  return {
    jobOrderId: col.text(header.id),
    reference: col.text(header.reference),
    customerId: col.text(header.customer_id),
    customerName: col.text(header.customer_name),
    branchName: col.text(header.branch_name),
    consignmentReference: col.text(header.consignment_reference),
    processingRequestReference: col.textOrNull(header.processing_request_reference),
    status: col.text(header.status),
    serviceType: col.text(header.service_type),
    machineName: col.textOrNull(header.machine_name),
    plannedInputKg: col.numeric(header.planned_input_kg),
    plannedKeshaCount: col.intOrNull(header.planned_kesha_count),
    scheduledStartAt: col.dateOrNull(header.scheduled_start_at),
    supervisorName: col.textOrNull(header.supervisor_name),
    notes: col.textOrNull(header.notes),
    createdAt: col.date(header.created_at),
    inputs: inputRows.map((row) => ({
      lineNo: col.int(row.line_no),
      lotReference: col.text(row.lot_reference),
      coffeeType: col.textOrNull(row.coffee_type),
      coffeeGrade: col.textOrNull(row.coffee_grade),
      quantityKg: col.numeric(row.quantity_kg),
      keshaCount: col.intOrNull(row.kesha_count),
    })),
    expectedOutputs: expectedOutputRows.map((row) => ({
      classificationName: col.text(row.classification_name),
      expectedYieldPct: col.numericOrNull(row.expected_yield_pct),
    })),
  }
}
