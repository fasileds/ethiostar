import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { ROLE_CODES, type RoleCode } from '@modules/identity'
import { receivablesSummary } from '@modules/billing'
import { systemClock } from '@core/clock/clock'
import {
  operationalDashboard,
  type OperationalDashboardData,
} from './operational-dashboard.query'

/**
 * Role-specific dashboard tiles (M21).
 *
 * A handful of focused queries per role rather than one query that returns every column any
 * role might want — a Store Manager's screen has no business paying the cost of a revenue
 * aggregate it never renders, and a wrong join on one role's data must not be able to corrupt
 * another's.
 *
 * A role with no dedicated view (Store Keeper, Security Officer, …) falls back to the
 * operational dashboard, which is meaningful to everyone on the floor.
 */

export interface GeneralManagerTiles {
  readonly kind: 'general_manager'
  readonly throughputKgThisMonth: string
  readonly revenueThisMonth: string
  readonly occupancyPct: number
  readonly receivablesOutstanding: string
  readonly overdueInvoiceCount: number
}

export interface StoreManagerTiles {
  readonly kind: 'store_manager'
  readonly capacityByWarehouse: readonly {
    readonly warehouseName: string
    readonly usedKg: string
    readonly capacityKg: string
    readonly occupancyPct: number
  }[]
  readonly ageingStock: {
    readonly over30Days: number
    readonly over60Days: number
    readonly over90Days: number
  }
  readonly movementsToday: number
}

export interface ProductionOperatorTiles {
  readonly kind: 'production_operator'
  readonly jobsScheduledToday: number
  readonly jobsInProgress: number
  readonly machineStatus: readonly {
    readonly machineName: string
    readonly isRunning: boolean
  }[]
}

export interface OperationalFallbackTiles extends OperationalDashboardData {
  readonly kind: 'operational'
}

export type RoleDashboardData =
  GeneralManagerTiles | StoreManagerTiles | ProductionOperatorTiles | OperationalFallbackTiles

async function generalManagerTiles(
  tx: Tx,
  branchId: string | null,
): Promise<GeneralManagerTiles> {
  const [throughput, revenue, occupancy, receivables] = await Promise.all([
    rawRows(
      tx,
      sql`
        select coalesce(sum(jo.actual_output_kg), 0) as kg
        from public.job_order jo
        where jo.completed_at >= date_trunc('month', now() at time zone 'Africa/Addis_Ababa')
          and (${branchId}::uuid is null or jo.branch_id = ${branchId}::uuid)
      `,
    ),
    rawRows(
      tx,
      sql`
        select coalesce(sum(inv.total_amount), 0) as amount
        from public.invoice inv
        where inv.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
          and inv.issue_date >= date_trunc('month', now() at time zone 'Africa/Addis_Ababa')::date
          and (${branchId}::uuid is null or inv.branch_id = ${branchId}::uuid)
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
    receivablesSummary(tx, systemClock.now()),
  ])

  const usedKg = col.int(occupancy[0]?.used_kg ?? 0)
  const safeCapacityKg = col.int(occupancy[0]?.safe_capacity_kg ?? 0)
  const occupancyPct =
    safeCapacityKg > 0 ? Math.round((usedKg / safeCapacityKg) * 1000) / 10 : 0

  return {
    kind: 'general_manager',
    throughputKgThisMonth: col.numeric(throughput[0]?.kg),
    revenueThisMonth: col.numeric(revenue[0]?.amount),
    occupancyPct,
    receivablesOutstanding: receivables.outstandingTotal,
    overdueInvoiceCount: receivables.overdueCount,
  }
}

async function storeManagerTiles(tx: Tx, branchId: string | null): Promise<StoreManagerTiles> {
  const [capacity, ageing, movements] = await Promise.all([
    rawRows(
      tx,
      sql`
        select
          wh.name_en as warehouse_name,
          coalesce(sum(sb.quantity_kg), 0) as used_kg,
          coalesce(sum(sec.capacity_kg * sec.safe_fill_pct), 0) as capacity_kg
        from public.warehouse wh
        join public.store_room rm on rm.warehouse_id = wh.id
        join public.store_section sec on sec.room_id = rm.id and sec.is_loss_account = false
        left join public.stock_balance sb on sb.location_id = sec.id
        where (${branchId}::uuid is null or wh.branch_id = ${branchId}::uuid)
        group by wh.id, wh.name_en
        order by wh.name_en
      `,
    ),
    rawRows(
      tx,
      sql`
        select
          count(*) filter (where l.storage_start_date <= (now() at time zone 'Africa/Addis_Ababa')::date - interval '30 days') as over30,
          count(*) filter (where l.storage_start_date <= (now() at time zone 'Africa/Addis_Ababa')::date - interval '60 days') as over60,
          count(*) filter (where l.storage_start_date <= (now() at time zone 'Africa/Addis_Ababa')::date - interval '90 days') as over90
        from public.lot l
        where l.status = 'IN_STORE'
      `,
    ),
    rawRows(
      tx,
      sql`
        select count(*) as cnt
        from public.stock_movement sm
        where sm.occurred_at::date = (now() at time zone 'Africa/Addis_Ababa')::date
      `,
    ),
  ])

  return {
    kind: 'store_manager',
    capacityByWarehouse: capacity.map((row) => {
      const usedKg = col.int(row.used_kg)
      const capacityKg = col.int(row.capacity_kg)
      return {
        warehouseName: col.text(row.warehouse_name),
        usedKg: col.numeric(row.used_kg),
        capacityKg: col.numeric(row.capacity_kg),
        occupancyPct: capacityKg > 0 ? Math.round((usedKg / capacityKg) * 1000) / 10 : 0,
      }
    }),
    ageingStock: {
      over30Days: col.int(ageing[0]?.over30 ?? 0),
      over60Days: col.int(ageing[0]?.over60 ?? 0),
      over90Days: col.int(ageing[0]?.over90 ?? 0),
    },
    movementsToday: col.int(movements[0]?.cnt ?? 0),
  }
}

async function productionOperatorTiles(
  tx: Tx,
  branchId: string | null,
): Promise<ProductionOperatorTiles> {
  const [jobs, machines] = await Promise.all([
    rawRows(
      tx,
      sql`
        select
          count(*) filter (where jo.scheduled_start_at::date = (now() at time zone 'Africa/Addis_Ababa')::date) as scheduled_today,
          count(*) filter (where jo.status = 'IN_PROGRESS') as in_progress
        from public.job_order jo
        where (${branchId}::uuid is null or jo.branch_id = ${branchId}::uuid)
      `,
    ),
    rawRows(
      tx,
      sql`
        select
          m.name_en as machine_name,
          exists(
            select 1 from public.job_order jo
            where jo.machine_id = m.id and jo.status = 'IN_PROGRESS'
          ) as is_running
        from public.machine m
        where m.is_active = true
          and (${branchId}::uuid is null or m.branch_id = ${branchId}::uuid)
        order by m.name_en
      `,
    ),
  ])

  return {
    kind: 'production_operator',
    jobsScheduledToday: col.int(jobs[0]?.scheduled_today ?? 0),
    jobsInProgress: col.int(jobs[0]?.in_progress ?? 0),
    machineStatus: machines.map((row) => ({
      machineName: col.text(row.machine_name),
      isRunning: col.bool(row.is_running),
    })),
  }
}

export async function roleDashboard(
  tx: Tx,
  role: RoleCode,
  branchId: string | null,
): Promise<RoleDashboardData> {
  if (role === ROLE_CODES.GENERAL_MANAGER || role === ROLE_CODES.FINANCE_OFFICER) {
    return generalManagerTiles(tx, branchId)
  }
  if (role === ROLE_CODES.STORE_MANAGER) {
    return storeManagerTiles(tx, branchId)
  }
  if (role === ROLE_CODES.PRODUCTION_OPERATOR) {
    return productionOperatorTiles(tx, branchId)
  }
  const fallback = await operationalDashboard(tx, branchId)
  return { kind: 'operational', ...fallback }
}
