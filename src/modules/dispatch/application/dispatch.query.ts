import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import {
  rawRows,
  col,
  listLimit,
  keysetBefore,
  toListPage,
  cursorValue,
  type ListPage,
} from '@db/helpers/list-query'

/**
 * M17 read models — including the GATE QUEUE, which is the highest-stakes screen here.
 *
 * `gateQueue` returns the clearance blockers alongside each order rather than a yes/no flag.
 * A guard refusing a truck needs to say WHY, and "blocked" with no reason gets overridden by
 * whoever is standing there with a phone. The reasons are recomputed live: an order cleared
 * on Monday against an acceptance disputed on Tuesday must not pass on Wednesday.
 */

export interface ReleaseRequestRow {
  readonly id: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly consignmentReference: string | null
  readonly status: string
  readonly requestedQuantityKg: string
  readonly requestedKeshaCount: number | null
  readonly requestedCollectionOn: string | null
  readonly authorisedByName: string | null
  readonly collectorName: string | null
  readonly vehiclePlate: string | null
  readonly createdAt: Date
}

export async function listReleaseRequests(
  tx: Tx,
  filters: {
    status?: string | undefined
    customerId?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<ReleaseRequestRow>> {
  const limit = listLimit(filters.limit)

  const rows = await rawRows(
    tx,
    sql`
      select
        r.id, r.reference, r.customer_id, r.status, r.requested_quantity_kg,
        r.requested_kesha_count, r.requested_collection_on, r.collector_name,
        r.vehicle_plate, r.created_at,
        cu.legal_name  as customer_name,
        cons.reference as consignment_reference,
        cc.full_name   as authorised_by_name
      from public.release_request r
      join public.customer cu on cu.id = r.customer_id
      left join public.consignment cons on cons.id = r.consignment_id
      left join public.customer_contact cc on cc.id = r.authorised_by_contact_id
      where 1 = 1
        ${filters.status ? sql`and r.status = ${filters.status}` : sql``}
        ${filters.customerId ? sql`and r.customer_id = ${filters.customerId}::uuid` : sql``}
        ${keysetBefore(sql`r.created_at`, sql`r.id`, filters.cursor)}
      order by r.created_at desc, r.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(
    rows.map((row): ReleaseRequestRow => ({
      id: col.text(row.id),
      reference: col.text(row.reference),
      customerId: col.text(row.customer_id),
      customerName: col.text(row.customer_name),
      consignmentReference: col.textOrNull(row.consignment_reference),
      status: col.text(row.status),
      requestedQuantityKg: col.numeric(row.requested_quantity_kg),
      requestedKeshaCount: col.intOrNull(row.requested_kesha_count),
      requestedCollectionOn: col.textOrNull(row.requested_collection_on),
      authorisedByName: col.textOrNull(row.authorised_by_name),
      collectorName: col.textOrNull(row.collector_name),
      vehiclePlate: col.textOrNull(row.vehicle_plate),
      createdAt: col.date(row.created_at),
    })),
    limit,
    (row) => ({ sortValue: cursorValue(row.createdAt), id: row.id }),
  )
}

export interface DispatchOrderRow {
  readonly id: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly consignmentReference: string | null
  readonly status: string
  readonly plannedQuantityKg: string
  readonly plannedKeshaCount: number | null
  readonly loadedQuantityKg: string | null
  readonly loadedKeshaCount: number | null
  readonly vehiclePlate: string | null
  readonly driverName: string | null
  readonly destination: string | null
  readonly clearanceStatus: string | null
  readonly clearanceNote: string | null
  readonly gateOutAt: Date | null
  readonly createdAt: Date
}

function toDispatchOrder(row: Record<string, unknown>): DispatchOrderRow {
  return {
    id: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    consignmentReference: col.textOrNull(row.consignment_reference),
    status: col.text(row.status),
    plannedQuantityKg: col.numeric(row.planned_quantity_kg),
    plannedKeshaCount: col.intOrNull(row.planned_kesha_count),
    loadedQuantityKg: col.numericOrNull(row.loaded_quantity_kg),
    loadedKeshaCount: col.intOrNull(row.loaded_kesha_count),
    vehiclePlate: col.textOrNull(row.vehicle_plate),
    driverName: col.textOrNull(row.driver_name),
    destination: col.textOrNull(row.destination),
    clearanceStatus: col.textOrNull(row.clearance_status),
    clearanceNote: col.textOrNull(row.clearance_note),
    gateOutAt: col.dateOrNull(row.gate_out_at),
    createdAt: col.date(row.created_at),
  }
}

export async function listDispatchOrders(
  tx: Tx,
  filters: {
    status?: string | undefined
    search?: string | undefined
    customerId?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<DispatchOrderRow>> {
  const limit = listLimit(filters.limit)
  const search = filters.search?.trim()

  const rows = await rawRows(
    tx,
    sql`
      select
        d.*,
        cu.legal_name  as customer_name,
        cons.reference as consignment_reference
      from public.dispatch_order d
      join public.customer cu on cu.id = d.customer_id
      left join public.consignment cons on cons.id = d.consignment_id
      where 1 = 1
        ${filters.status ? sql`and d.status = ${filters.status}` : sql``}
        ${filters.customerId ? sql`and d.customer_id = ${filters.customerId}::uuid` : sql``}
        ${
          search
            ? sql`and (d.reference ilike ${'%' + search + '%'}
                    or d.vehicle_plate ilike ${'%' + search + '%'}
                    or cu.legal_name ilike ${'%' + search + '%'})`
            : sql``
        }
        ${keysetBefore(sql`d.created_at`, sql`d.id`, filters.cursor)}
      order by d.created_at desc, d.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(rows.map(toDispatchOrder), limit, (row) => ({
    sortValue: cursorValue(row.createdAt),
    id: row.id,
  }))
}

export async function dispatchStatusCounts(
  tx: Tx,
  customerId?: string,
): Promise<Readonly<Record<string, number>>> {
  const rows = await rawRows(
    tx,
    sql`
      select status, count(*)::int as total
      from public.dispatch_order
      where 1 = 1 ${customerId ? sql`and customer_id = ${customerId}::uuid` : sql``}
      group by status
    `,
  )
  return Object.fromEntries(rows.map((row) => [col.text(row.status), col.int(row.total)]))
}

export interface GateQueueEntry extends DispatchOrderRow {
  readonly acceptanceReference: string | null
  readonly acceptanceStatus: string | null
  readonly releaseStatus: string | null
  readonly lineCount: number
  /** Empty means clear. Anything in here is a reason to refuse, in plain words. */
  readonly blockers: readonly string[]
}

/**
 * Orders waiting at the gate, with their clearance recomputed on read.
 *
 * The blockers are derived here rather than trusted from `clearance_status` because that
 * column records what was true when it was written. The gate needs what is true NOW.
 */
export async function gateQueue(tx: Tx): Promise<GateQueueEntry[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        d.*,
        cu.legal_name  as customer_name,
        cons.reference as consignment_reference,
        ar.reference   as acceptance_reference,
        ar.status      as acceptance_status,
        rr.status      as release_status,
        (select count(*) from public.dispatch_line dl where dl.dispatch_order_id = d.id)::int
          as line_count
      from public.dispatch_order d
      join public.customer cu on cu.id = d.customer_id
      left join public.consignment cons on cons.id = d.consignment_id
      left join public.acceptance_record ar on ar.id = d.acceptance_id
      left join public.release_request rr on rr.id = d.release_request_id
      where d.status in ('PLANNED','LOADING','LOADED','GATE_CLEARED')
      order by d.loading_completed_at asc nulls last, d.created_at asc
      limit 100
    `,
  )

  return rows.map((row) => {
    const order = toDispatchOrder(row)
    const acceptanceStatus = col.textOrNull(row.acceptance_status)
    const releaseStatus = col.textOrNull(row.release_status)
    const lineCount = col.int(row.line_count)

    const blockers: string[] = []
    if (releaseStatus === null) {
      blockers.push('No release request is linked to this order.')
    } else if (releaseStatus !== 'APPROVED' && releaseStatus !== 'DISPATCHED') {
      blockers.push(`Release request is ${releaseStatus}, not approved.`)
    }

    if (acceptanceStatus === null) {
      blockers.push('No Mirt Merekebiya acceptance is linked to this order.')
    } else if (acceptanceStatus === 'DISPUTED') {
      blockers.push('The acceptance is disputed. Coffee must not move while it is open.')
    } else if (acceptanceStatus !== 'ACCEPTED' && acceptanceStatus !== 'PARTIALLY_ACCEPTED') {
      blockers.push(`Acceptance is ${acceptanceStatus} — the customer has not signed.`)
    }

    if (lineCount === 0) blockers.push('No lines have been loaded against this order.')
    if (order.status === 'PLANNED') blockers.push('Loading has not started.')
    if (!order.vehiclePlate) blockers.push('No vehicle plate recorded.')
    if (!order.driverName) blockers.push('No driver recorded.')

    return {
      ...order,
      acceptanceReference: col.textOrNull(row.acceptance_reference),
      acceptanceStatus,
      releaseStatus,
      lineCount,
      blockers,
    }
  })
}

export interface DispatchLineRow {
  readonly id: string
  readonly lineNo: number
  readonly lotReference: string
  readonly locationCode: string | null
  readonly bagTypeName: string | null
  readonly quantityKg: string
  readonly keshaCount: number
  readonly loadedAt: Date | null
}

export async function dispatchLines(
  tx: Tx,
  dispatchOrderId: string,
): Promise<DispatchLineRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        dl.id, dl.line_no, dl.quantity_kg, dl.kesha_count, dl.loaded_at,
        l.reference as lot_reference,
        s.code      as location_code,
        bt.name_en  as bag_type_name
      from public.dispatch_line dl
      join public.lot l on l.id = dl.lot_id
      left join public.store_section s on s.id = dl.location_id
      left join public.bag_type bt on bt.id = dl.bag_type_id
      where dl.dispatch_order_id = ${dispatchOrderId}::uuid
      order by dl.line_no
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    lineNo: col.int(row.line_no),
    lotReference: col.text(row.lot_reference),
    locationCode: col.textOrNull(row.location_code),
    bagTypeName: col.textOrNull(row.bag_type_name),
    quantityKg: col.numeric(row.quantity_kg),
    keshaCount: col.int(row.kesha_count),
    loadedAt: col.dateOrNull(row.loaded_at),
  }))
}

export interface GateEventRow {
  readonly id: string
  readonly direction: string
  readonly vehiclePlate: string
  readonly driverName: string | null
  readonly captureMethod: string
  readonly manualReason: string | null
  readonly guardNote: string | null
  readonly occurredAt: Date
  readonly recordedAt: Date
}

/** Recent gate movements, both directions. */
export async function recentGateEvents(tx: Tx, limit = 40): Promise<GateEventRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, direction, vehicle_plate, driver_name, capture_method,
             manual_reason, guard_note, occurred_at, recorded_at
      from public.gate_event
      order by occurred_at desc
      limit ${limit}
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    direction: col.text(row.direction),
    vehiclePlate: col.text(row.vehicle_plate),
    driverName: col.textOrNull(row.driver_name),
    captureMethod: col.text(row.capture_method),
    manualReason: col.textOrNull(row.manual_reason),
    guardNote: col.textOrNull(row.guard_note),
    occurredAt: col.date(row.occurred_at),
    recordedAt: col.date(row.recorded_at),
  }))
}

/**
 * Vehicles currently on site.
 *
 * "Last event was IN" — computed with DISTINCT ON over the append-only gate log rather than
 * a mutable on-site flag, which would drift the first time an event was recorded late.
 */
export interface OnSiteVehicle {
  readonly vehiclePlate: string
  readonly driverName: string | null
  readonly since: Date
}

export async function vehiclesOnSite(tx: Tx): Promise<OnSiteVehicle[]> {
  const rows = await rawRows(
    tx,
    sql`
      select vehicle_plate, driver_name, occurred_at as since
      from (
        select distinct on (vehicle_plate)
          vehicle_plate, driver_name, direction, occurred_at
        from public.gate_event
        order by vehicle_plate, occurred_at desc
      ) latest
      where direction = 'IN'
      order by occurred_at asc
    `,
  )

  return rows.map((row) => ({
    vehiclePlate: col.text(row.vehicle_plate),
    driverName: col.textOrNull(row.driver_name),
    since: col.date(row.since),
  }))
}
