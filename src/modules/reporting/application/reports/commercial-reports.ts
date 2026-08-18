import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * Commercial & financial reports (client document §7.2, "Commercial & financial" group).
 *
 * Every function here is gated behind `report:view_financial` at the route/UI layer — never
 * `report:view_operational` — because revenue and receivables are exactly the numbers a Store
 * Keeper must not see. Storage charges are covered by `revenueByCustomer` (service code
 * `STORAGE_PER_DAY` is one row among the others); rate override exceptions are left for a
 * later pass, noted rather than silently dropped.
 */

export interface RevenueByCustomerRow {
  readonly customerName: string
  readonly serviceCode: string
  readonly chargeCount: number
  readonly totalAmount: string
}

export async function revenueByCustomer(
  tx: Tx,
  params: {
    readonly branchId: string | null
    readonly periodStart: string
    readonly periodEnd: string
  },
): Promise<readonly RevenueByCustomerRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select cu.legal_name as customer_name, ce.service_code,
        count(*) as charge_count, coalesce(sum(ce.amount), 0) as total_amount
      from public.charge_event ce
      join public.customer cu on cu.id = ce.customer_id
      where ce.occurred_at::date between ${params.periodStart}::date and ${params.periodEnd}::date
        and (${params.branchId}::uuid is null or ce.branch_id = ${params.branchId}::uuid)
      group by cu.legal_name, ce.service_code
      order by cu.legal_name, total_amount desc
    `,
  )
  return rows.map((row) => ({
    customerName: col.text(row.customer_name),
    serviceCode: col.text(row.service_code),
    chargeCount: col.int(row.charge_count),
    totalAmount: col.numeric(row.total_amount),
  }))
}

export interface ReceivablesAgeingRow {
  readonly customerName: string
  readonly invoiceReference: string
  readonly dueDate: string
  readonly daysOverdue: number
  readonly outstandingAmount: string
}

export async function receivablesAgeing(
  tx: Tx,
  params: { readonly branchId: string | null; readonly asOfDate: string },
): Promise<readonly ReceivablesAgeingRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select cu.legal_name as customer_name, inv.reference as invoice_reference,
        inv.due_date, greatest(${params.asOfDate}::date - inv.due_date, 0) as days_overdue,
        inv.total_amount - inv.paid_amount as outstanding_amount
      from public.invoice inv
      join public.customer cu on cu.id = inv.customer_id
      where inv.status in ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
        and inv.total_amount > inv.paid_amount
        and (${params.branchId}::uuid is null or inv.branch_id = ${params.branchId}::uuid)
      order by days_overdue desc
    `,
  )
  return rows.map((row) => ({
    customerName: col.text(row.customer_name),
    invoiceReference: col.text(row.invoice_reference),
    dueDate: col.text(row.due_date),
    daysOverdue: col.int(row.days_overdue),
    outstandingAmount: col.numeric(row.outstanding_amount),
  }))
}

export interface LabourCostByConsignmentRow {
  readonly consignmentReference: string
  readonly customerName: string
  readonly outputLines: number
  readonly totalKg: string
  readonly totalCost: string
}

export async function labourCostByConsignment(
  tx: Tx,
  params: {
    readonly branchId: string | null
    readonly periodStart: string
    readonly periodEnd: string
  },
): Promise<readonly LabourCostByConsignmentRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select c.reference as consignment_reference, cu.legal_name as customer_name,
        count(*) as output_lines,
        coalesce(sum(lo.quantity_kg), 0) as total_kg,
        coalesce(sum(lo.calculated_amount), 0) as total_cost
      from public.labour_output lo
      join public.job_order jo on jo.id = lo.job_order_id
      join public.consignment c on c.id = jo.consignment_id
      join public.customer cu on cu.id = jo.customer_id
      where lo.status in ('APPROVED', 'PAID')
        and lo.produced_on between ${params.periodStart}::date and ${params.periodEnd}::date
        and (${params.branchId}::uuid is null or jo.branch_id = ${params.branchId}::uuid)
      group by c.reference, cu.legal_name
      order by total_cost desc
    `,
  )
  return rows.map((row) => ({
    consignmentReference: col.text(row.consignment_reference),
    customerName: col.text(row.customer_name),
    outputLines: col.int(row.output_lines),
    totalKg: col.numeric(row.total_kg),
    totalCost: col.numeric(row.total_cost),
  }))
}
