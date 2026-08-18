import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * Store & inventory reports (client document §7.2, "Store & inventory" group).
 *
 * Bag stock/consumption is Kesha module territory and is left out of this first pass — the
 * three here (stock on hand, occupancy, ageing, movement register) are the ones every store
 * manager asks for daily.
 */

export interface StockOnHandRow {
  readonly customerName: string
  readonly warehouseName: string
  readonly roomCode: string
  readonly sectionCode: string
  readonly lotReference: string
  readonly quantityKg: string
  readonly keshaCount: number
}

export async function stockOnHandByLocation(
  tx: Tx,
  params: { readonly branchId: string | null },
): Promise<readonly StockOnHandRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        cu.legal_name as customer_name, wh.name_en as warehouse_name,
        rm.code as room_code, sec.code as section_code, l.reference as lot_reference,
        sb.quantity_kg, sb.kesha_count
      from public.stock_balance sb
      join public.lot l on l.id = sb.lot_id
      join public.customer cu on cu.id = sb.customer_id
      join public.store_section sec on sec.id = sb.location_id
      join public.store_room rm on rm.id = sec.room_id
      join public.warehouse wh on wh.id = rm.warehouse_id
      where sb.quantity_kg > 0
        and (${params.branchId}::uuid is null or wh.branch_id = ${params.branchId}::uuid)
      order by cu.legal_name, wh.name_en, rm.code, sec.code
    `,
  )
  return rows.map((row) => ({
    customerName: col.text(row.customer_name),
    warehouseName: col.text(row.warehouse_name),
    roomCode: col.text(row.room_code),
    sectionCode: col.text(row.section_code),
    lotReference: col.text(row.lot_reference),
    quantityKg: col.numeric(row.quantity_kg),
    keshaCount: col.int(row.kesha_count),
  }))
}

export interface OccupancyByLocationRow {
  readonly warehouseName: string
  readonly roomCode: string
  readonly sectionCode: string
  readonly usedKg: string
  readonly capacityKg: string
  readonly occupancyPct: number
}

export async function occupancyByLocation(
  tx: Tx,
  params: { readonly branchId: string | null },
): Promise<readonly OccupancyByLocationRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        wh.name_en as warehouse_name, rm.code as room_code, sec.code as section_code,
        coalesce(sum(sb.quantity_kg), 0) as used_kg,
        sec.capacity_kg * sec.safe_fill_pct as capacity_kg
      from public.store_section sec
      join public.store_room rm on rm.id = sec.room_id
      join public.warehouse wh on wh.id = rm.warehouse_id
      left join public.stock_balance sb on sb.location_id = sec.id
      where sec.is_loss_account = false
        and (${params.branchId}::uuid is null or wh.branch_id = ${params.branchId}::uuid)
      group by wh.name_en, rm.code, sec.code, sec.capacity_kg, sec.safe_fill_pct
      order by wh.name_en, rm.code, sec.code
    `,
  )
  return rows.map((row) => {
    const usedKg = col.int(row.used_kg)
    const capacityKg = col.int(row.capacity_kg)
    return {
      warehouseName: col.text(row.warehouse_name),
      roomCode: col.text(row.room_code),
      sectionCode: col.text(row.section_code),
      usedKg: col.numeric(row.used_kg),
      capacityKg: col.numeric(row.capacity_kg),
      occupancyPct: capacityKg > 0 ? Math.round((usedKg / capacityKg) * 1000) / 10 : 0,
    }
  })
}

export interface AgeingStockRow {
  readonly customerName: string
  readonly lotReference: string
  readonly storageStartDate: string | null
  readonly dwellDays: number
  readonly quantityKg: string
}

export async function ageingStockReport(
  tx: Tx,
  params: { readonly branchId: string | null; readonly asOfDate: string },
): Promise<readonly AgeingStockRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        cu.legal_name as customer_name, l.reference as lot_reference,
        l.storage_start_date,
        (${params.asOfDate}::date - l.storage_start_date) as dwell_days,
        sb.quantity_kg
      from public.stock_balance sb
      join public.lot l on l.id = sb.lot_id
      join public.customer cu on cu.id = sb.customer_id
      join public.consignment c on c.id = sb.consignment_id
      where sb.quantity_kg > 0 and l.storage_start_date is not null
        and (${params.branchId}::uuid is null or c.branch_id = ${params.branchId}::uuid)
      order by dwell_days desc
    `,
  )
  return rows.map((row) => ({
    customerName: col.text(row.customer_name),
    lotReference: col.text(row.lot_reference),
    storageStartDate: col.textOrNull(row.storage_start_date),
    dwellDays: col.int(row.dwell_days),
    quantityKg: col.numeric(row.quantity_kg),
  }))
}

export interface MovementRegisterRow {
  readonly occurredAt: Date
  readonly movementType: string
  readonly lotReference: string
  readonly locationCode: string
  readonly quantityKg: string
  readonly actorName: string | null
}

export async function movementRegister(
  tx: Tx,
  params: {
    readonly branchId: string | null
    readonly periodStart: string
    readonly periodEnd: string
  },
): Promise<readonly MovementRegisterRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        sm.occurred_at, sm.movement_type, l.reference as lot_reference,
        sec.code as location_code, sm.quantity_kg, u.full_name as actor_name
      from public.stock_movement sm
      join public.lot l on l.id = sm.lot_id
      join public.store_section sec on sec.id = sm.location_id
      join public.store_room rm on rm.id = sec.room_id
      join public.warehouse wh on wh.id = rm.warehouse_id
      left join public.app_user u on u.id = sm.actor_id
      where sm.occurred_at::date between ${params.periodStart}::date and ${params.periodEnd}::date
        and (${params.branchId}::uuid is null or wh.branch_id = ${params.branchId}::uuid)
      order by sm.occurred_at desc
      limit 1000
    `,
  )
  return rows.map((row) => ({
    occurredAt: col.date(row.occurred_at),
    movementType: col.text(row.movement_type),
    lotReference: col.text(row.lot_reference),
    locationCode: col.text(row.location_code),
    quantityKg: col.numeric(row.quantity_kg),
    actorName: col.textOrNull(row.actor_name),
  }))
}
