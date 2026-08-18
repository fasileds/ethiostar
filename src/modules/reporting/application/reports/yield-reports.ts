import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * Yield & output reports (client document §7.2, "Yield & output" group).
 *
 * Yield by origin is left out of this pass — origin lives on the consignment (woreda/region)
 * and joining it in cleanly wants its own query; customer and coffee type cover the reports
 * a production manager actually opens daily.
 */

export interface YieldByCustomerRow {
  readonly customerName: string
  readonly coffeeTypeName: string | null
  readonly jobsCompleted: number
  readonly inputKg: string
  readonly outputKg: string
  readonly lossKg: string
  readonly avgYieldPct: number | null
}

export async function yieldAnalysisByCustomer(
  tx: Tx,
  params: {
    readonly branchId: string | null
    readonly periodStart: string
    readonly periodEnd: string
  },
): Promise<readonly YieldByCustomerRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        cu.legal_name as customer_name, ct.name_en as coffee_type_name,
        count(*) as jobs_completed,
        coalesce(sum(jo.actual_input_kg), 0) as input_kg,
        coalesce(sum(jo.actual_output_kg), 0) as output_kg,
        coalesce(sum(jo.actual_loss_kg), 0) as loss_kg,
        avg(jo.yield_pct) as avg_yield_pct
      from public.job_order jo
      join public.customer cu on cu.id = jo.customer_id
      join public.consignment c on c.id = jo.consignment_id
      left join public.coffee_type ct on ct.id = c.coffee_type_id
      where jo.status in ('COMPLETED', 'CLOSED')
        and jo.completed_at::date between ${params.periodStart}::date and ${params.periodEnd}::date
        and (${params.branchId}::uuid is null or jo.branch_id = ${params.branchId}::uuid)
      group by cu.legal_name, ct.name_en
      order by cu.legal_name
    `,
  )
  return rows.map((row) => ({
    customerName: col.text(row.customer_name),
    coffeeTypeName: col.textOrNull(row.coffee_type_name),
    jobsCompleted: col.int(row.jobs_completed),
    inputKg: col.numeric(row.input_kg),
    outputKg: col.numeric(row.output_kg),
    lossKg: col.numeric(row.loss_kg),
    avgYieldPct: row.avg_yield_pct === null ? null : Number(row.avg_yield_pct),
  }))
}

export interface OutputClassificationBreakdownRow {
  readonly classificationName: string
  readonly isExportReady: boolean
  readonly outputLines: number
  readonly quantityKg: string
}

export async function outputClassificationBreakdown(
  tx: Tx,
  params: {
    readonly branchId: string | null
    readonly periodStart: string
    readonly periodEnd: string
  },
): Promise<readonly OutputClassificationBreakdownRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        oc.name_en as classification_name, oc.is_export_ready,
        count(*) as output_lines,
        coalesce(sum(joo.quantity_kg), 0) as quantity_kg
      from public.job_order_output joo
      join public.job_order jo on jo.id = joo.job_order_id
      join public.output_classification oc on oc.id = joo.classification_id
      where joo.is_loss = false
        and joo.produced_at::date between ${params.periodStart}::date and ${params.periodEnd}::date
        and (${params.branchId}::uuid is null or jo.branch_id = ${params.branchId}::uuid)
      group by oc.name_en, oc.is_export_ready
      order by quantity_kg desc
    `,
  )
  return rows.map((row) => ({
    classificationName: col.text(row.classification_name),
    isExportReady: col.bool(row.is_export_ready),
    outputLines: col.int(row.output_lines),
    quantityKg: col.numeric(row.quantity_kg),
  }))
}

export interface MassBalanceExceptionRow {
  readonly jobReference: string
  readonly customerName: string
  readonly plannedInputKg: string
  readonly actualInputKg: string | null
  readonly actualOutputKg: string | null
  readonly varianceKg: string | null
  readonly toleranceAppliedPct: string | null
  readonly closedAt: Date | null
}

export async function massBalanceExceptions(
  tx: Tx,
  params: {
    readonly branchId: string | null
    readonly periodStart: string
    readonly periodEnd: string
  },
): Promise<readonly MassBalanceExceptionRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        jo.reference as job_reference, cu.legal_name as customer_name,
        jo.planned_input_kg, jo.actual_input_kg, jo.actual_output_kg,
        jo.variance_kg, jo.tolerance_applied_pct, jo.closed_at
      from public.job_order jo
      join public.customer cu on cu.id = jo.customer_id
      where jo.mass_balance_status = 'EXCEPTION'
        and jo.closed_at::date between ${params.periodStart}::date and ${params.periodEnd}::date
        and (${params.branchId}::uuid is null or jo.branch_id = ${params.branchId}::uuid)
      order by jo.closed_at desc
    `,
  )
  return rows.map((row) => ({
    jobReference: col.text(row.job_reference),
    customerName: col.text(row.customer_name),
    plannedInputKg: col.numeric(row.planned_input_kg),
    actualInputKg: col.numericOrNull(row.actual_input_kg),
    actualOutputKg: col.numericOrNull(row.actual_output_kg),
    varianceKg: col.numericOrNull(row.variance_kg),
    toleranceAppliedPct: col.numericOrNull(row.tolerance_applied_pct),
    closedAt: col.dateOrNull(row.closed_at),
  }))
}
