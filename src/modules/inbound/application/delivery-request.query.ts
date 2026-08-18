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
 * M11 read models — the delivery-request queue and its detail.
 *
 * The approval screen shows requested space against AVAILABLE space, not against total
 * capacity. Approving against a total that ignores existing reservations is how ten requests
 * all "fit" on Monday and none of them do on Friday.
 */

export interface DeliveryRequestRow {
  readonly id: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly status: string
  readonly coffeeTypeName: string | null
  readonly declaredQuantityKg: string
  readonly declaredKeshaCount: number
  readonly expectedArrivalOn: string
  readonly vehiclePlate: string | null
  readonly consignmentId: string | null
  readonly createdAt: Date
}

export interface DeliveryRequestFilters {
  readonly status?: string | undefined
  readonly search?: string | undefined
  readonly customerId?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

export async function listDeliveryRequests(
  tx: Tx,
  filters: DeliveryRequestFilters = {},
): Promise<ListPage<DeliveryRequestRow>> {
  const limit = listLimit(filters.limit)
  const search = filters.search?.trim()

  const rows = await rawRows(
    tx,
    sql`
      select
        r.id, r.reference, r.customer_id, r.status,
        r.declared_quantity_kg, r.declared_kesha_count,
        r.expected_arrival_on, r.vehicle_plate, r.consignment_id, r.created_at,
        c.legal_name as customer_name,
        ct.name_en   as coffee_type_name
      from public.delivery_request r
      join public.customer c        on c.id  = r.customer_id
      left join public.coffee_type ct on ct.id = r.coffee_type_id
      where 1 = 1
        ${filters.status ? sql`and r.status = ${filters.status}` : sql``}
        ${filters.customerId ? sql`and r.customer_id = ${filters.customerId}::uuid` : sql``}
        ${
          search
            ? sql`and (r.reference ilike ${'%' + search + '%'}
                    or c.legal_name ilike ${'%' + search + '%'}
                    or r.vehicle_plate ilike ${'%' + search + '%'})`
            : sql``
        }
        ${keysetBefore(sql`r.created_at`, sql`r.id`, filters.cursor)}
      order by r.created_at desc, r.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(
    rows.map((row): DeliveryRequestRow => ({
      id: col.text(row.id),
      reference: col.text(row.reference),
      customerId: col.text(row.customer_id),
      customerName: col.text(row.customer_name),
      status: col.text(row.status),
      coffeeTypeName: col.textOrNull(row.coffee_type_name),
      declaredQuantityKg: col.numeric(row.declared_quantity_kg),
      declaredKeshaCount: col.int(row.declared_kesha_count),
      expectedArrivalOn: col.text(row.expected_arrival_on),
      vehiclePlate: col.textOrNull(row.vehicle_plate),
      consignmentId: col.textOrNull(row.consignment_id),
      createdAt: col.date(row.created_at),
    })),
    limit,
    (row) => ({ sortValue: cursorValue(row.createdAt), id: row.id }),
  )
}

export async function deliveryRequestStatusCounts(
  tx: Tx,
  customerId?: string,
): Promise<Readonly<Record<string, number>>> {
  const rows = await rawRows(
    tx,
    sql`
      select status, count(*)::int as total
      from public.delivery_request
      where 1 = 1 ${customerId ? sql`and customer_id = ${customerId}::uuid` : sql``}
      group by status
    `,
  )
  return Object.fromEntries(rows.map((row) => [col.text(row.status), col.int(row.total)]))
}

export interface DeliveryRequestDetail extends DeliveryRequestRow {
  readonly branchId: string
  readonly branchName: string | null
  readonly coffeeGradeName: string | null
  readonly originWoredaName: string | null
  readonly harvestYearName: string | null
  readonly bagTypeName: string | null
  readonly expectedArrivalWindow: string | null
  readonly transportMode: string | null
  readonly driverName: string | null
  readonly driverPhone: string | null
  readonly notes: string | null
  readonly rejectionReason: string | null
  readonly cancelledReason: string | null
  readonly submittedAt: Date | null
  readonly approvedAt: Date | null
  readonly approvedByName: string | null
  readonly reservationId: string | null
  readonly reservedLocationCode: string | null
  readonly consignmentReference: string | null
  readonly requestLetterFileId: string | null
}

export async function findDeliveryRequest(
  tx: Tx,
  id: string,
): Promise<DeliveryRequestDetail | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        r.*,
        c.legal_name  as customer_name,
        b.name_en     as branch_name,
        ct.name_en    as coffee_type_name,
        cg.name_en    as coffee_grade_name,
        w.name_en     as origin_woreda_name,
        hy.name_en    as harvest_year_name,
        bt.name_en    as bag_type_name,
        u.full_name   as approved_by_name,
        cons.reference as consignment_reference,
        s.code        as reserved_location_code
      from public.delivery_request r
      join public.customer c            on c.id  = r.customer_id
      left join public.branch b         on b.id  = r.branch_id
      left join public.coffee_type ct   on ct.id = r.coffee_type_id
      left join public.coffee_grade cg  on cg.id = r.coffee_grade_id
      left join public.woreda w         on w.id  = r.origin_woreda_id
      left join public.harvest_year hy  on hy.id = r.harvest_year_id
      left join public.bag_type bt      on bt.id = r.bag_type_id
      left join public.app_user u       on u.id  = r.approved_by
      left join public.consignment cons on cons.id = r.consignment_id
      left join public.capacity_reservation cr on cr.id = r.reservation_id
      left join public.store_section s  on s.id  = cr.location_id
      where r.id = ${id}::uuid
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    id: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    branchName: col.textOrNull(row.branch_name),
    status: col.text(row.status),
    branchId: col.text(row.branch_id),
    coffeeTypeName: col.textOrNull(row.coffee_type_name),
    coffeeGradeName: col.textOrNull(row.coffee_grade_name),
    originWoredaName: col.textOrNull(row.origin_woreda_name),
    harvestYearName: col.textOrNull(row.harvest_year_name),
    bagTypeName: col.textOrNull(row.bag_type_name),
    declaredQuantityKg: col.numeric(row.declared_quantity_kg),
    declaredKeshaCount: col.int(row.declared_kesha_count),
    expectedArrivalOn: col.text(row.expected_arrival_on),
    expectedArrivalWindow: col.textOrNull(row.expected_arrival_window),
    transportMode: col.textOrNull(row.transport_mode),
    vehiclePlate: col.textOrNull(row.vehicle_plate),
    driverName: col.textOrNull(row.driver_name),
    driverPhone: col.textOrNull(row.driver_phone),
    notes: col.textOrNull(row.notes),
    rejectionReason: col.textOrNull(row.rejection_reason),
    cancelledReason: col.textOrNull(row.cancelled_reason),
    submittedAt: col.dateOrNull(row.submitted_at),
    approvedAt: col.dateOrNull(row.approved_at),
    approvedByName: col.textOrNull(row.approved_by_name),
    reservationId: col.textOrNull(row.reservation_id),
    reservedLocationCode: col.textOrNull(row.reserved_location_code),
    consignmentId: col.textOrNull(row.consignment_id),
    consignmentReference: col.textOrNull(row.consignment_reference),
    requestLetterFileId: col.textOrNull(row.request_letter_file_id),
    createdAt: col.date(row.created_at),
  }
}

/**
 * Sections with room for a given load, best fit first.
 *
 * Reads `vw_section_capacity`, which nets ACTIVE reservations off physical capacity — the
 * whole point of the view. Ordered by tightest fit so the yard is packed rather than
 * fragmented, but a section is only offered if it clears BOTH the weight and the bag count:
 * a room can run out of floor for bags while still having weight headroom.
 */
export interface AvailableSection {
  readonly locationId: string
  readonly sectionCode: string
  readonly roomCode: string
  readonly warehouseCode: string
  readonly freeKg: string
  readonly freeKesha: number
}

export async function sectionsWithRoom(
  tx: Tx,
  quantityKg: string,
  keshaCount: number,
): Promise<AvailableSection[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        v.location_id, v.section_code, v.room_code, v.warehouse_code,
        (v.capacity_kg * v.safe_fill_pct - v.reserved_kg)   as free_kg,
        (v.capacity_kesha - v.reserved_kesha)::int          as free_kesha
      from public.vw_section_capacity v
      where not v.is_loss_account
        and (v.capacity_kg * v.safe_fill_pct - v.reserved_kg) >= ${quantityKg}::numeric
        and (v.capacity_kesha - v.reserved_kesha) >= ${keshaCount}
      order by free_kg asc
      limit 20
    `,
  )

  return rows.map((row) => ({
    locationId: col.text(row.location_id),
    sectionCode: col.text(row.section_code),
    roomCode: col.text(row.room_code),
    warehouseCode: col.text(row.warehouse_code),
    freeKg: col.numeric(row.free_kg),
    freeKesha: col.int(row.free_kesha),
  }))
}

/** The receiving bay's work list: approved or arrived, expected today or overdue. */
export interface ExpectedArrival {
  readonly id: string
  readonly reference: string
  readonly customerName: string
  readonly status: string
  readonly declaredQuantityKg: string
  readonly declaredKeshaCount: number
  readonly expectedArrivalOn: string
  readonly vehiclePlate: string | null
  readonly driverName: string | null
  readonly consignmentId: string | null
  readonly reservedLocationCode: string | null
  readonly isOverdue: boolean
}

export async function expectedArrivals(
  tx: Tx,
  businessDate: string,
): Promise<ExpectedArrival[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        r.id, r.reference, r.status, r.declared_quantity_kg, r.declared_kesha_count,
        r.expected_arrival_on, r.vehicle_plate, r.driver_name, r.consignment_id,
        c.legal_name as customer_name,
        s.code       as reserved_location_code,
        (r.expected_arrival_on < ${businessDate}::date) as is_overdue
      from public.delivery_request r
      join public.customer c on c.id = r.customer_id
      left join public.capacity_reservation cr on cr.id = r.reservation_id
      left join public.store_section s on s.id = cr.location_id
      where r.status in ('APPROVED','SCHEDULED','ARRIVED')
        and r.expected_arrival_on <= ${businessDate}::date
      order by
        -- Arrived vehicles are on site and waiting; they come first regardless of date.
        case when r.status = 'ARRIVED' then 0 else 1 end,
        r.expected_arrival_on asc,
        r.reference asc
      limit 100
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    reference: col.text(row.reference),
    customerName: col.text(row.customer_name),
    status: col.text(row.status),
    declaredQuantityKg: col.numeric(row.declared_quantity_kg),
    declaredKeshaCount: col.int(row.declared_kesha_count),
    expectedArrivalOn: col.text(row.expected_arrival_on),
    vehiclePlate: col.textOrNull(row.vehicle_plate),
    driverName: col.textOrNull(row.driver_name),
    consignmentId: col.textOrNull(row.consignment_id),
    reservedLocationCode: col.textOrNull(row.reserved_location_code),
    isOverdue: col.bool(row.is_overdue),
  }))
}

/** Goods receipts, most recent first. The receiving history screen. */
export interface GoodsReceiptRow {
  readonly id: string
  readonly reference: string
  readonly customerName: string
  readonly consignmentReference: string | null
  readonly status: string
  readonly receivedQuantityKg: string
  readonly receivedKeshaCount: number
  readonly varianceKg: string | null
  readonly variancePct: string | null
  readonly locationCode: string | null
  readonly occurredAt: Date
}

export async function listGoodsReceipts(
  tx: Tx,
  filters: {
    status?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<GoodsReceiptRow>> {
  const limit = listLimit(filters.limit)

  const rows = await rawRows(
    tx,
    sql`
      select
        g.id, g.reference, g.status, g.received_quantity_kg, g.received_kesha_count,
        g.variance_kg, g.variance_pct, g.occurred_at,
        c.legal_name  as customer_name,
        cons.reference as consignment_reference,
        s.code        as location_code
      from public.goods_receipt g
      join public.customer c            on c.id = g.customer_id
      left join public.consignment cons on cons.id = g.consignment_id
      left join public.store_section s  on s.id = g.location_id
      where 1 = 1
        ${filters.status ? sql`and g.status = ${filters.status}` : sql``}
        ${keysetBefore(sql`g.occurred_at`, sql`g.id`, filters.cursor)}
      order by g.occurred_at desc, g.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(
    rows.map((row): GoodsReceiptRow => ({
      id: col.text(row.id),
      reference: col.text(row.reference),
      customerName: col.text(row.customer_name),
      consignmentReference: col.textOrNull(row.consignment_reference),
      status: col.text(row.status),
      receivedQuantityKg: col.numeric(row.received_quantity_kg),
      receivedKeshaCount: col.int(row.received_kesha_count),
      varianceKg: col.numericOrNull(row.variance_kg),
      variancePct: col.numericOrNull(row.variance_pct),
      locationCode: col.textOrNull(row.location_code),
      occurredAt: col.date(row.occurred_at),
    })),
    limit,
    (row) => ({ sortValue: cursorValue(row.occurredAt), id: row.id }),
  )
}
