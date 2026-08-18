import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Stock Count Sheet (M06 §7.x, series CNT).
 *
 * A count is per-location, not per-customer — one sheet can carry lines for several
 * customers' lots, so unlike the GRN there is no single `customerId` on the header.
 */

export interface StockCountPrintLine {
  readonly lineId: string
  readonly lotReference: string
  readonly customerName: string
  readonly coffeeType: string | null
  readonly coffeeGrade: string | null
  readonly bagType: string | null
  readonly expectedQuantityKg: string
  readonly expectedKeshaCount: number
  readonly countedQuantityKg: string
  readonly countedKeshaCount: number
  readonly varianceKg: string
  readonly varianceKesha: number
  readonly reasonName: string | null
  readonly narrative: string | null
}

export interface StockCountSnapshot {
  readonly countId: string
  readonly reference: string
  readonly branchName: string
  readonly locationLabel: string
  readonly countedOn: string
  readonly status: string
  readonly countedByName: string | null
  readonly approvedByName: string | null
  readonly approvedAt: Date | null
  readonly lines: readonly StockCountPrintLine[]
}

export async function loadStockCountSnapshot(
  tx: Tx,
  countId: string,
): Promise<StockCountSnapshot | undefined> {
  const headerRows = await rawRows(
    tx,
    sql`
      select
        sc.id, sc.reference, sc.counted_on, sc.status, sc.approved_at,
        counter.full_name as counted_by_name, appr.full_name as approved_by_name,
        wh.name_en as warehouse_name, rm.code as room_code, sec.code as section_code,
        br.name_en as branch_name
      from public.stock_count sc
      join public.store_section sec on sec.id = sc.location_id
      join public.store_room rm on rm.id = sec.room_id
      join public.warehouse wh on wh.id = rm.warehouse_id
      join public.branch br on br.id = wh.branch_id
      left join public.app_user counter on counter.id = sc.counted_by
      left join public.app_user appr on appr.id = sc.approved_by
      where sc.id = ${countId}::uuid
      limit 1
    `,
  )

  const header = headerRows[0]
  if (!header) return undefined

  const lineRows = await rawRows(
    tx,
    sql`
      select
        scl.id, scl.expected_quantity_kg, scl.expected_kesha_count,
        scl.counted_quantity_kg, scl.counted_kesha_count, scl.narrative,
        l.reference as lot_reference, cu.legal_name as customer_name,
        ct.name_en as coffee_type, cg.name_en as coffee_grade, bt.name_en as bag_type,
        rc.name_en as reason_name,
        (scl.counted_quantity_kg - scl.expected_quantity_kg) as variance_kg,
        (scl.counted_kesha_count - scl.expected_kesha_count) as variance_kesha
      from public.stock_count_line scl
      join public.lot l on l.id = scl.lot_id
      join public.customer cu on cu.id = l.customer_id
      left join public.coffee_type ct on ct.id = l.coffee_type_id
      left join public.coffee_grade cg on cg.id = l.coffee_grade_id
      left join public.bag_type bt on bt.id = l.bag_type_id
      left join public.reason_code rc on rc.id = scl.reason_code_id
      where scl.count_id = ${countId}::uuid
      order by l.reference
    `,
  )

  return {
    countId: col.text(header.id),
    reference: col.text(header.reference),
    branchName: col.text(header.branch_name),
    locationLabel: `${col.text(header.warehouse_name)} / ${col.text(header.room_code)} / ${col.text(header.section_code)}`,
    countedOn: col.text(header.counted_on),
    status: col.text(header.status),
    countedByName: col.textOrNull(header.counted_by_name),
    approvedByName: col.textOrNull(header.approved_by_name),
    approvedAt: col.dateOrNull(header.approved_at),
    lines: lineRows.map((row) => ({
      lineId: col.text(row.id),
      lotReference: col.text(row.lot_reference),
      customerName: col.text(row.customer_name),
      coffeeType: col.textOrNull(row.coffee_type),
      coffeeGrade: col.textOrNull(row.coffee_grade),
      bagType: col.textOrNull(row.bag_type),
      expectedQuantityKg: col.numeric(row.expected_quantity_kg),
      expectedKeshaCount: col.int(row.expected_kesha_count),
      countedQuantityKg: col.numeric(row.counted_quantity_kg),
      countedKeshaCount: col.int(row.counted_kesha_count),
      varianceKg: col.numeric(row.variance_kg),
      varianceKesha: col.int(row.variance_kesha),
      reasonName: col.textOrNull(row.reason_name),
      narrative: col.textOrNull(row.narrative),
    })),
  }
}
