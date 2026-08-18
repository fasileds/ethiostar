import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * Operations reports (client document §7.2, "Operations" group).
 *
 * `dailyOperationsSummary`, `consignmentStatusByCustomer` and `appointmentDelaysByCause`
 * cover the day-to-day and the scheduling-cascade questions. Production plan vs actual and
 * request-to-appointment waiting time are left for a later pass — noted, not silently
 * dropped, in the M21 delivery report.
 */

export interface DailyOperationsSummaryRow {
  readonly metric: string
  readonly count: number
  readonly quantityKg: string
}

export async function dailyOperationsSummary(
  tx: Tx,
  params: { readonly branchId: string | null; readonly date: string },
): Promise<readonly DailyOperationsSummaryRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select 'Goods received' as metric, count(*) as cnt,
        coalesce(sum(gr.received_quantity_kg), 0) as kg
      from public.goods_receipt gr
      where gr.status = 'POSTED' and gr.occurred_at::date = ${params.date}::date
        and (${params.branchId}::uuid is null or gr.branch_id = ${params.branchId}::uuid)
      union all
      select 'Jobs completed' as metric, count(*) as cnt,
        coalesce(sum(jo.actual_output_kg), 0) as kg
      from public.job_order jo
      where jo.completed_at::date = ${params.date}::date
        and (${params.branchId}::uuid is null or jo.branch_id = ${params.branchId}::uuid)
      union all
      select 'Acceptances issued' as metric, count(*) as cnt,
        coalesce(sum(ar.presented_quantity_kg), 0) as kg
      from public.acceptance_record ar
      where ar.status in ('ACCEPTED', 'PARTIALLY_ACCEPTED')
        and ar.updated_at::date = ${params.date}::date
        and (${params.branchId}::uuid is null or ar.branch_id = ${params.branchId}::uuid)
      union all
      select 'Dispatches completed' as metric, count(distinct d.id) as cnt,
        coalesce(sum(dl.quantity_kg), 0) as kg
      from public.dispatch_order d
      left join public.dispatch_line dl on dl.dispatch_order_id = d.id
      where d.status = 'DISPATCHED' and d.updated_at::date = ${params.date}::date
        and (${params.branchId}::uuid is null or d.branch_id = ${params.branchId}::uuid)
    `,
  )
  return rows.map((row) => ({
    metric: col.text(row.metric),
    count: col.int(row.cnt),
    quantityKg: col.numeric(row.kg),
  }))
}

export interface ConsignmentStatusByCustomerRow {
  readonly customerName: string
  readonly status: string
  readonly consignments: number
  readonly quantityKg: string
}

export async function consignmentStatusByCustomer(
  tx: Tx,
  params: { readonly branchId: string | null },
): Promise<readonly ConsignmentStatusByCustomerRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select cu.legal_name as customer_name, c.status,
        count(*) as consignments,
        coalesce(sum(coalesce(c.received_quantity_kg, c.declared_quantity_kg, 0)), 0) as quantity_kg
      from public.consignment c
      join public.customer cu on cu.id = c.customer_id
      where (${params.branchId}::uuid is null or c.branch_id = ${params.branchId}::uuid)
      group by cu.legal_name, c.status
      order by cu.legal_name, c.status
    `,
  )
  return rows.map((row) => ({
    customerName: col.text(row.customer_name),
    status: col.text(row.status),
    consignments: col.int(row.consignments),
    quantityKg: col.numeric(row.quantity_kg),
  }))
}

export interface AppointmentDelayByCauseRow {
  readonly causeCode: string
  readonly occurrences: number
  readonly totalDelayMinutes: number
  readonly affectedAppointments: number
}

export async function appointmentDelaysByCause(
  tx: Tx,
  params: { readonly periodStart: string; readonly periodEnd: string },
): Promise<readonly AppointmentDelayByCauseRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select sd.cause_code,
        count(*) as occurrences,
        coalesce(sum(sd.delay_minutes), 0) as total_delay_minutes,
        coalesce(sum(sd.affected_appointments), 0) as affected_appointments
      from public.schedule_delay sd
      where sd.occurred_on between ${params.periodStart}::date and ${params.periodEnd}::date
      group by sd.cause_code
      order by total_delay_minutes desc
    `,
  )
  return rows.map((row) => ({
    causeCode: col.text(row.cause_code),
    occurrences: col.int(row.occurrences),
    totalDelayMinutes: col.int(row.total_delay_minutes),
    affectedAppointments: col.int(row.affected_appointments),
  }))
}
