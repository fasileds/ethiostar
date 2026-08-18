import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Yield & Reconciliation Statement (M06 §7.x, M15) — the
 * mass-balance reconciliation frozen when a job order closes.
 *
 * Assembled once, at print time, and stored verbatim in `printed_document.printed_snapshot` —
 * a later master-data edit must not silently change what a document that already left the
 * building says. The figures themselves are read from the columns `close-job.ts` froze at
 * close, never recomputed here.
 */

export interface YieldStatementOutputLine {
  readonly lineNo: number
  readonly classificationName: string | null
  readonly quantityKg: string
  readonly keshaCount: number | null
  readonly yieldPct: string | null
}

export interface YieldStatementSnapshot {
  readonly jobOrderId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchName: string
  readonly consignmentReference: string
  readonly serviceType: string
  readonly closedAt: Date | null

  readonly actualInputKg: string
  readonly actualOutputKg: string
  readonly actualLossKg: string
  readonly yieldPct: string | null
  readonly lossPct: string | null
  readonly varianceKg: string | null
  readonly toleranceAppliedPct: string | null
  readonly massBalanceStatus: string | null
  readonly withinTolerance: boolean
  readonly varianceReason: string | null
  readonly varianceApprovedByName: string | null

  readonly outputs: readonly YieldStatementOutputLine[]
}

export async function loadYieldStatementSnapshot(
  tx: Tx,
  jobOrderId: string,
): Promise<YieldStatementSnapshot | undefined> {
  const headerRows = await rawRows(
    tx,
    sql`
      select
        j.id, j.reference, j.customer_id, cu.legal_name as customer_name,
        br.name_en as branch_name, cons.reference as consignment_reference,
        j.service_type, j.closed_at,
        j.actual_input_kg, j.actual_output_kg, j.actual_loss_kg,
        j.yield_pct, j.loss_pct, j.variance_kg, j.tolerance_applied_pct,
        j.mass_balance_status, j.variance_reason,
        va.full_name as variance_approved_by_name
      from public.job_order j
      join public.customer cu on cu.id = j.customer_id
      join public.branch br on br.id = j.branch_id
      join public.consignment cons on cons.id = j.consignment_id
      left join public.app_user va on va.id = j.variance_approved_by
      where j.id = ${jobOrderId}::uuid
      limit 1
    `,
  )

  const header = headerRows[0]
  if (!header) return undefined

  const outputRows = await rawRows(
    tx,
    sql`
      select
        o.line_no, o.quantity_kg, o.kesha_count, o.percent_of_input,
        oc.name_en as classification_name
      from public.job_order_output o
      left join public.output_classification oc on oc.id = o.classification_id
      where o.job_order_id = ${jobOrderId}::uuid and o.is_loss = false
      order by o.line_no
    `,
  )

  const massBalanceStatus = col.textOrNull(header.mass_balance_status)

  return {
    jobOrderId: col.text(header.id),
    reference: col.text(header.reference),
    customerId: col.text(header.customer_id),
    customerName: col.text(header.customer_name),
    branchName: col.text(header.branch_name),
    consignmentReference: col.text(header.consignment_reference),
    serviceType: col.text(header.service_type),
    closedAt: col.dateOrNull(header.closed_at),

    actualInputKg: col.numeric(header.actual_input_kg),
    actualOutputKg: col.numeric(header.actual_output_kg),
    actualLossKg: col.numeric(header.actual_loss_kg),
    yieldPct: col.numericOrNull(header.yield_pct),
    lossPct: col.numericOrNull(header.loss_pct),
    varianceKg: col.numericOrNull(header.variance_kg),
    toleranceAppliedPct: col.numericOrNull(header.tolerance_applied_pct),
    massBalanceStatus,
    withinTolerance:
      massBalanceStatus === 'BALANCED' || massBalanceStatus === 'WITHIN_TOLERANCE',
    varianceReason: col.textOrNull(header.variance_reason),
    varianceApprovedByName: col.textOrNull(header.variance_approved_by_name),

    outputs: outputRows.map((row) => ({
      lineNo: col.int(row.line_no),
      classificationName: col.textOrNull(row.classification_name),
      quantityKg: col.numeric(row.quantity_kg),
      keshaCount: col.intOrNull(row.kesha_count),
      yieldPct: col.numericOrNull(row.percent_of_input),
    })),
  }
}
