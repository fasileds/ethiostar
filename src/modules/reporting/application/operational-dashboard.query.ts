import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The live operational dashboard (M21) — "received today, in process now, awaiting
 * acceptance, awaiting dispatch, occupancy %, today's exceptions" in one read.
 *
 * Each figure is its own small query rather than one join, deliberately: the six facts come
 * from six different tables with no natural join key between them, and forcing one would
 * either fan out rows (double-counting) or require six CTEs that are no cheaper to read than
 * six statements.
 */

export interface OperationalDashboardData {
  readonly receivedTodayCount: number
  readonly receivedTodayKg: string
  readonly inProcessCount: number
  readonly awaitingAcceptanceCount: number
  readonly awaitingDispatchCount: number
  readonly occupancyPct: number
  readonly exceptionsToday: {
    readonly massBalanceExceptions: number
    readonly flaggedAdjustments: number
    readonly overdueInvoices: number
  }
}

export async function operationalDashboard(
  tx: Tx,
  branchId: string | null,
): Promise<OperationalDashboardData> {
  const [received, inProcess, awaitingAcceptance, awaitingDispatch, occupancy, exceptions] =
    await Promise.all([
      rawRows(
        tx,
        sql`
          select count(*) as cnt, coalesce(sum(gr.received_quantity_kg), 0) as kg
          from public.goods_receipt gr
          where gr.status = 'POSTED'
            and gr.occurred_at::date = (now() at time zone 'Africa/Addis_Ababa')::date
            and (${branchId}::uuid is null or gr.branch_id = ${branchId}::uuid)
        `,
      ),
      rawRows(
        tx,
        sql`
          select count(*) as cnt
          from public.job_order jo
          where jo.status = 'IN_PROGRESS'
            and (${branchId}::uuid is null or jo.branch_id = ${branchId}::uuid)
        `,
      ),
      rawRows(
        tx,
        sql`
          select count(*) as cnt
          from public.acceptance_record ar
          where ar.status = 'PRESENTED'
            and (${branchId}::uuid is null or ar.branch_id = ${branchId}::uuid)
        `,
      ),
      rawRows(
        tx,
        sql`
          select count(*) as cnt
          from public.dispatch_order d
          where d.status not in ('DISPATCHED', 'CANCELLED')
            and (${branchId}::uuid is null or d.branch_id = ${branchId}::uuid)
        `,
      ),
      rawRows(
        tx,
        sql`
          select
            coalesce(sum(sb.quantity_kg), 0) as used_kg,
            coalesce(sum(sec.capacity_kg * sec.safe_fill_pct), 0) as safe_capacity_kg
          from public.store_section sec
          join public.store_room rm on rm.id = sec.room_id
          join public.warehouse wh on wh.id = rm.warehouse_id
          left join public.stock_balance sb on sb.location_id = sec.id
          where sec.is_loss_account = false
            and (${branchId}::uuid is null or wh.branch_id = ${branchId}::uuid)
        `,
      ),
      rawRows(
        tx,
        sql`
          select
            (select count(*) from public.job_order jo
              where jo.mass_balance_status = 'EXCEPTION'
                and jo.closed_at::date = (now() at time zone 'Africa/Addis_Ababa')::date
                and (${branchId}::uuid is null or jo.branch_id = ${branchId}::uuid)) as mass_balance_exceptions,
            (select count(*) from public.stock_adjustment sa
              join public.reason_code rc on rc.id = sa.reason_code_id
              where rc.is_exception = true
                and sa.occurred_at::date = (now() at time zone 'Africa/Addis_Ababa')::date) as flagged_adjustments,
            (select count(*) from public.invoice inv
              where inv.status in ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
                and inv.due_date < (now() at time zone 'Africa/Addis_Ababa')::date
                and inv.total_amount > inv.paid_amount
                and (${branchId}::uuid is null or inv.branch_id = ${branchId}::uuid)) as overdue_invoices
        `,
      ),
    ])

  const usedKg = col.int(occupancy[0]?.used_kg ?? 0)
  const safeCapacityKg = col.int(occupancy[0]?.safe_capacity_kg ?? 0)
  const occupancyPct =
    safeCapacityKg > 0 ? Math.round((usedKg / safeCapacityKg) * 1000) / 10 : 0

  return {
    receivedTodayCount: col.int(received[0]?.cnt ?? 0),
    receivedTodayKg: col.numeric(received[0]?.kg),
    inProcessCount: col.int(inProcess[0]?.cnt ?? 0),
    awaitingAcceptanceCount: col.int(awaitingAcceptance[0]?.cnt ?? 0),
    awaitingDispatchCount: col.int(awaitingDispatch[0]?.cnt ?? 0),
    occupancyPct,
    exceptionsToday: {
      massBalanceExceptions: col.int(exceptions[0]?.mass_balance_exceptions ?? 0),
      flaggedAdjustments: col.int(exceptions[0]?.flagged_adjustments ?? 0),
      overdueInvoices: col.int(exceptions[0]?.overdue_invoices ?? 0),
    },
  }
}
