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
 * The consignment spine, read side — including the COFFEE PASSPORT.
 *
 * The passport is the client's headline requirement: one reference that follows the coffee
 * from the request letter to the dispatch truck. It is assembled from the operational tables
 * at read time rather than maintained as a denormalised document, because a document that is
 * maintained is a document that goes stale, and this one is quoted in disputes.
 */

export interface ConsignmentRow {
  readonly id: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly status: string
  readonly coffeeTypeName: string | null
  readonly declaredQuantityKg: string | null
  readonly receivedQuantityKg: string | null
  readonly receivedKeshaCount: number | null
  readonly onHandKg: string
  readonly onHandKesha: number
  readonly receivedAt: Date | null
  readonly createdAt: Date
}

export interface ConsignmentFilters {
  readonly status?: string | undefined
  readonly search?: string | undefined
  readonly customerId?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

export async function listConsignments(
  tx: Tx,
  filters: ConsignmentFilters = {},
): Promise<ListPage<ConsignmentRow>> {
  const limit = listLimit(filters.limit)
  const search = filters.search?.trim()

  const rows = await rawRows(
    tx,
    sql`
      select
        c.id, c.reference, c.customer_id, c.status,
        c.declared_quantity_kg, c.received_quantity_kg, c.received_kesha_count,
        c.received_at, c.created_at,
        cu.legal_name as customer_name,
        ct.name_en    as coffee_type_name,
        coalesce(bal.quantity_kg, 0)      as on_hand_kg,
        coalesce(bal.kesha_count, 0)::int as on_hand_kesha
      from public.consignment c
      join public.customer cu         on cu.id = c.customer_id
      left join public.coffee_type ct on ct.id = c.coffee_type_id
      left join lateral (
        select sum(b.quantity_kg) as quantity_kg, sum(b.kesha_count) as kesha_count
        from public.stock_balance b
        where b.consignment_id = c.id and b.quantity_kg > 0
      ) bal on true
      where 1 = 1
        ${filters.status ? sql`and c.status = ${filters.status}` : sql``}
        ${filters.customerId ? sql`and c.customer_id = ${filters.customerId}::uuid` : sql``}
        ${
          search
            ? sql`and (c.reference ilike ${'%' + search + '%'}
                    or cu.legal_name ilike ${'%' + search + '%'})`
            : sql``
        }
        ${keysetBefore(sql`c.created_at`, sql`c.id`, filters.cursor)}
      order by c.created_at desc, c.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(
    rows.map((row): ConsignmentRow => ({
      id: col.text(row.id),
      reference: col.text(row.reference),
      customerId: col.text(row.customer_id),
      customerName: col.text(row.customer_name),
      status: col.text(row.status),
      coffeeTypeName: col.textOrNull(row.coffee_type_name),
      declaredQuantityKg: col.numericOrNull(row.declared_quantity_kg),
      receivedQuantityKg: col.numericOrNull(row.received_quantity_kg),
      receivedKeshaCount: col.intOrNull(row.received_kesha_count),
      onHandKg: col.numeric(row.on_hand_kg),
      onHandKesha: col.int(row.on_hand_kesha),
      receivedAt: col.dateOrNull(row.received_at),
      createdAt: col.date(row.created_at),
    })),
    limit,
    (row) => ({ sortValue: cursorValue(row.createdAt), id: row.id }),
  )
}

export async function consignmentStatusCounts(
  tx: Tx,
  customerId?: string,
): Promise<Readonly<Record<string, number>>> {
  const rows = await rawRows(
    tx,
    sql`
      select status, count(*)::int as total
      from public.consignment
      where 1 = 1 ${customerId ? sql`and customer_id = ${customerId}::uuid` : sql``}
      group by status
    `,
  )
  return Object.fromEntries(rows.map((row) => [col.text(row.status), col.int(row.total)]))
}

export interface ConsignmentDetail extends ConsignmentRow {
  readonly branchName: string | null
  readonly coffeeGradeName: string | null
  readonly originWoredaName: string | null
  readonly harvestYearName: string | null
  readonly declaredKeshaCount: number | null
  readonly expectedArrivalOn: string | null
  readonly deliveryRequestId: string | null
  readonly deliveryRequestReference: string | null
}

export async function findConsignment(
  tx: Tx,
  id: string,
): Promise<ConsignmentDetail | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        c.*,
        cu.legal_name as customer_name,
        b.name_en     as branch_name,
        ct.name_en    as coffee_type_name,
        cg.name_en    as coffee_grade_name,
        w.name_en     as origin_woreda_name,
        hy.name_en    as harvest_year_name,
        dr.reference  as delivery_request_reference,
        coalesce(bal.quantity_kg, 0)      as on_hand_kg,
        coalesce(bal.kesha_count, 0)::int as on_hand_kesha
      from public.consignment c
      join public.customer cu            on cu.id = c.customer_id
      left join public.branch b          on b.id  = c.branch_id
      left join public.coffee_type ct    on ct.id = c.coffee_type_id
      left join public.coffee_grade cg   on cg.id = c.coffee_grade_id
      left join public.woreda w          on w.id  = c.origin_woreda_id
      left join public.harvest_year hy   on hy.id = c.harvest_year_id
      left join public.delivery_request dr on dr.id = c.delivery_request_id
      left join lateral (
        select sum(b2.quantity_kg) as quantity_kg, sum(b2.kesha_count) as kesha_count
        from public.stock_balance b2
        where b2.consignment_id = c.id and b2.quantity_kg > 0
      ) bal on true
      where c.id = ${id}::uuid
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
    coffeeTypeName: col.textOrNull(row.coffee_type_name),
    coffeeGradeName: col.textOrNull(row.coffee_grade_name),
    originWoredaName: col.textOrNull(row.origin_woreda_name),
    harvestYearName: col.textOrNull(row.harvest_year_name),
    declaredQuantityKg: col.numericOrNull(row.declared_quantity_kg),
    declaredKeshaCount: col.intOrNull(row.declared_kesha_count),
    receivedQuantityKg: col.numericOrNull(row.received_quantity_kg),
    receivedKeshaCount: col.intOrNull(row.received_kesha_count),
    onHandKg: col.numeric(row.on_hand_kg),
    onHandKesha: col.int(row.on_hand_kesha),
    expectedArrivalOn: col.textOrNull(row.expected_arrival_on),
    receivedAt: col.dateOrNull(row.received_at),
    deliveryRequestId: col.textOrNull(row.delivery_request_id),
    deliveryRequestReference: col.textOrNull(row.delivery_request_reference),
    createdAt: col.date(row.created_at),
  }
}

export interface LotRow {
  readonly id: string
  readonly reference: string
  readonly status: string
  readonly quantityKg: string
  readonly keshaCount: number
  readonly classificationName: string | null
  readonly gradeName: string | null
  readonly locationCode: string | null
  readonly roomCode: string | null
  readonly createdAt: Date
}

export async function consignmentLots(tx: Tx, consignmentId: string): Promise<LotRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        l.id, l.reference, l.status, l.created_at,
        oc.name_en as classification_name,
        cg.name_en as grade_name,
        s.code     as location_code,
        rm.code    as room_code,
        coalesce(bal.quantity_kg, 0)      as quantity_kg,
        coalesce(bal.kesha_count, 0)::int as kesha_count
      from public.lot l
      left join public.output_classification oc on oc.id = l.output_classification_id
      left join public.coffee_grade cg on cg.id = l.coffee_grade_id
      left join lateral (
        select b.quantity_kg, b.kesha_count, b.location_id
        from public.stock_balance b
        where b.lot_id = l.id and b.quantity_kg > 0
        order by b.quantity_kg desc
        limit 1
      ) bal on true
      left join public.store_section s on s.id = bal.location_id
      left join public.store_room rm   on rm.id = s.room_id
      where l.consignment_id = ${consignmentId}::uuid
      order by l.created_at asc
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    reference: col.text(row.reference),
    status: col.text(row.status),
    quantityKg: col.numeric(row.quantity_kg),
    keshaCount: col.int(row.kesha_count),
    classificationName: col.textOrNull(row.classification_name),
    gradeName: col.textOrNull(row.grade_name),
    locationCode: col.textOrNull(row.location_code),
    roomCode: col.textOrNull(row.room_code),
    createdAt: col.date(row.created_at),
  }))
}

/**
 * The passport lives in M07, not here.
 *
 * `coffeePassport` in @modules/audit derives the timeline from `domain_event` and
 * `stock_movement` — the append-only sources — which is why it cannot disagree with the
 * record it describes. A second timeline assembled from the operational tables would be
 * easier to render and would drift the first time a status was corrected, so it is
 * deliberately absent. See docs/architecture/03-domain-model.md §3.11.
 */
