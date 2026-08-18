import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { col } from '@db/helpers/list-query'

/**
 * Dashboard read models.
 *
 * Deliberately a QUERY layer returning DTOs, not entities. M21 (Phase 2) builds its
 * dashboards and BI on this same layer rather than querying aggregates, which is why it
 * exists now — see docs/architecture/07-extension-points.md.
 *
 * Every figure comes from `stock_balance` and the operational tables. Nothing is
 * approximated: a dashboard that rounds is a dashboard someone eventually reconciles
 * against and finds wrong.
 */

export interface StockByStatus {
  readonly status: string
  readonly consignments: number
  readonly quantityKg: string
  readonly keshaCount: number
}

export interface OperationalCounts {
  readonly pendingApplications: number
  readonly pendingDeliveryRequests: number
  readonly awaitingAcceptance: number
  readonly pendingReleases: number
  readonly jobsToday: number
  readonly receivedToday: number
}

/** Live stock grouped by lifecycle stage — the M09 headline figure, in BOTH units. */
export async function stockByStatus(tx: Tx, customerId?: string): Promise<StockByStatus[]> {
  const result = await tx.execute(sql`
    select
      c.status,
      count(distinct c.id)::int         as consignments,
      coalesce(sum(b.quantity_kg), 0)   as quantity_kg,
      coalesce(sum(b.kesha_count), 0)::int as kesha_count
    from public.consignment c
    left join public.stock_balance b on b.consignment_id = c.id and b.quantity_kg > 0
    where c.status not in ('CLOSED', 'CANCELLED')
      ${customerId ? sql`and c.customer_id = ${customerId}` : sql``}
    group by c.status
    order by c.status
  `)

  const rows = result as unknown as Array<{
    status: string
    consignments: number
    quantity_kg: string
    kesha_count: number
  }>

  return rows.map((row) => ({
    status: row.status,
    consignments: row.consignments,
    // numeric arrives as a string and stays one until a Weight parses it.
    quantityKg: String(row.quantity_kg),
    keshaCount: row.kesha_count,
  }))
}

/** Totals across everything currently in custody. */
export async function totalInCustody(
  tx: Tx,
  customerId?: string,
): Promise<{ quantityKg: string; keshaCount: number; lots: number }> {
  const result = await tx.execute(sql`
    select
      coalesce(sum(b.quantity_kg), 0)      as quantity_kg,
      coalesce(sum(b.kesha_count), 0)::int as kesha_count,
      count(distinct b.lot_id)::int        as lots
    from public.stock_balance b
    where b.quantity_kg > 0
      ${customerId ? sql`and b.customer_id = ${customerId}` : sql``}
  `)

  const rows = result as unknown as Array<{
    quantity_kg: string
    kesha_count: number
    lots: number
  }>
  const row = rows[0]

  return {
    quantityKg: String(row?.quantity_kg ?? '0'),
    keshaCount: row?.kesha_count ?? 0,
    lots: row?.lots ?? 0,
  }
}

/**
 * The counts behind the nav badges and the "needs attention" tiles.
 *
 * One round trip rather than six: this runs on every dashboard load and each separate query
 * would be another connection checkout from a pool sized for the whole plant.
 */
export async function operationalCounts(tx: Tx): Promise<OperationalCounts> {
  const result = await tx.execute(sql`
    select
      (select count(*) from public.customer_application
        where status in ('SUBMITTED','UNDER_REVIEW'))::int              as pending_applications,
      (select count(*) from public.delivery_request
        where status = 'SUBMITTED')::int                                as pending_delivery_requests,
      (select count(*) from public.consignment
        where status = 'PROCESSED')::int                                as awaiting_acceptance,
      (select count(*) from public.consignment
        where status = 'RELEASE_REQUESTED')::int                        as pending_releases,
      (select count(*) from public.job_order
        where status in ('ACCEPTED','IN_PROGRESS'))::int                as jobs_today,
      (select count(*) from public.consignment
        where received_at >= date_trunc('day', now() at time zone 'Africa/Addis_Ababa'))::int
                                                                        as received_today
  `)

  const rows = result as unknown as Array<Record<string, number>>
  const row = rows[0] ?? {}

  return {
    pendingApplications: row.pending_applications ?? 0,
    pendingDeliveryRequests: row.pending_delivery_requests ?? 0,
    awaitingAcceptance: row.awaiting_acceptance ?? 0,
    pendingReleases: row.pending_releases ?? 0,
    jobsToday: row.jobs_today ?? 0,
    receivedToday: row.received_today ?? 0,
  }
}

export interface RecentConsignment {
  readonly id: string
  readonly reference: string
  readonly status: string
  readonly customerName: string | null
  readonly quantityKg: string | null
  readonly keshaCount: number | null
  readonly receivedAt: Date | null
  readonly createdAt: Date
}

/** The most recently touched consignments — the operator's "where was I" list. */
export async function recentConsignments(
  tx: Tx,
  limit = 8,
  customerId?: string,
): Promise<RecentConsignment[]> {
  const result = await tx.execute(sql`
    select
      c.id, c.reference, c.status, c.received_at, c.created_at,
      c.received_quantity_kg as quantity_kg,
      c.received_kesha_count as kesha_count,
      cu.legal_name as customer_name
    from public.consignment c
    left join public.customer cu on cu.id = c.customer_id
    where 1 = 1
      ${customerId ? sql`and c.customer_id = ${customerId}` : sql``}
    order by coalesce(c.received_at, c.created_at) desc
    limit ${limit}
  `)

  const rows = result as unknown as Array<Record<string, unknown>>

  return rows.map((row) => ({
    id: String(row.id),
    reference: String(row.reference),
    status: String(row.status),
    customerName: (row.customer_name as string | null) ?? null,
    quantityKg: row.quantity_kg === null ? null : String(row.quantity_kg),
    keshaCount: row.kesha_count === null ? null : Number(row.kesha_count),
    receivedAt: col.dateOrNull(row.received_at),
    createdAt: col.date(row.created_at),
  }))
}

export interface RoomOccupancy {
  readonly locationId: string
  readonly warehouseCode: string
  readonly roomCode: string
  readonly sectionCode: string
  readonly capacityKg: string
  readonly occupiedKg: string
  readonly reservedKg: string
  readonly occupancyPct: number
}

/**
 * Occupancy per section — "will it fit?" at a glance.
 *
 * Reads the live view rather than a materialized one: a stale occupancy figure means coffee
 * accepted against space that does not exist, which is the M11 control.
 */
export async function roomOccupancy(tx: Tx): Promise<RoomOccupancy[]> {
  const result = await tx.execute(sql`
    select
      v.location_id, v.warehouse_code, v.room_code, v.section_code,
      v.capacity_kg, v.reserved_kg,
      coalesce(sum(b.quantity_kg), 0) as occupied_kg
    from public.vw_section_capacity v
    left join public.stock_balance b on b.location_id = v.location_id and b.quantity_kg > 0
    where not v.is_loss_account
    group by v.location_id, v.warehouse_code, v.room_code, v.section_code,
             v.capacity_kg, v.reserved_kg
    order by v.warehouse_code, v.room_code, v.section_code
  `)

  const rows = result as unknown as Array<Record<string, unknown>>

  return rows.map((row) => {
    const capacity = Number(row.capacity_kg)
    const occupied = Number(row.occupied_kg)
    return {
      locationId: String(row.location_id),
      warehouseCode: String(row.warehouse_code),
      roomCode: String(row.room_code),
      sectionCode: String(row.section_code),
      capacityKg: String(row.capacity_kg),
      occupiedKg: String(row.occupied_kg),
      reservedKg: String(row.reserved_kg),
      // Display-only, so a float is acceptable here — never for a stored quantity.
      occupancyPct: capacity > 0 ? Math.round((occupied / capacity) * 100) : 0,
    }
  })
}

export interface DailyIntake {
  /** Business date in Africa/Addis_Ababa, as YYYY-MM-DD. */
  readonly day: string
  /** Exact decimal string. Never a JS number — see core/units. */
  readonly quantityKg: string
  readonly keshaCount: number
  readonly consignments: number
}

/**
 * Coffee received per business day, for the intake trend on the operations dashboard.
 *
 * `generate_series` supplies the spine so days with no intake come back as zero rather than
 * as absent rows. A trend that silently omits its empty days is a trend that lies: a plant
 * which received nothing on Tuesday and 40 tonnes on Wednesday would otherwise draw the same
 * shape as one that received 40 tonnes two days running.
 *
 * Bucketed on the Africa/Addis_Ababa business date, matching `receivedToday` in
 * operationalCounts — the two figures appear on the same screen and must agree.
 */
export async function dailyIntake(tx: Tx, days = 14): Promise<DailyIntake[]> {
  const result = await tx.execute(sql`
    with spine as (
      select generate_series(
        (date_trunc('day', now() at time zone 'Africa/Addis_Ababa') - make_interval(days => ${days - 1}))::date,
        (date_trunc('day', now() at time zone 'Africa/Addis_Ababa'))::date,
        interval '1 day'
      )::date as day
    ),
    intake as (
      select
        (c.received_at at time zone 'Africa/Addis_Ababa')::date as day,
        coalesce(sum(c.received_quantity_kg), 0) as quantity_kg,
        coalesce(sum(c.received_kesha_count), 0) as kesha_count,
        count(*)                                 as consignments
      from public.consignment c
      where c.received_at is not null
        and c.received_at >= (
          date_trunc('day', now() at time zone 'Africa/Addis_Ababa')
          - make_interval(days => ${days - 1})
        )
      group by 1
    )
    select
      to_char(s.day, 'YYYY-MM-DD')            as day,
      coalesce(i.quantity_kg, 0)::text        as quantity_kg,
      coalesce(i.kesha_count, 0)::int         as kesha_count,
      coalesce(i.consignments, 0)::int        as consignments
    from spine s
    left join intake i on i.day = s.day
    order by s.day
  `)

  const rows = result as unknown as Array<Record<string, unknown>>

  return rows.map((row) => ({
    day: String(row.day),
    quantityKg: String(row.quantity_kg),
    keshaCount: Number(row.kesha_count),
    consignments: Number(row.consignments),
  }))
}
