import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Mirt Merekebiya — Customer Output Acceptance (M16 §7.x).
 *
 * The commercial hinge of the whole system: this is the document the customer signs to take
 * ownership of the processed output. Assembled once, at print time, and stored verbatim in
 * `printed_document.printed_snapshot` — a later correction to the acceptance record (which
 * supersedes rather than edits) must not silently change what a signed copy already says.
 */

export interface MirtMerekebiyaOutputLine {
  readonly lineNo: number
  readonly classificationCode: string | null
  readonly classificationName: string | null
  readonly lotReference: string | null
  readonly quantityKg: string
  readonly keshaCount: number | null
  readonly locationLabel: string | null
  readonly lineVerdict: string
}

export interface MirtMerekebiyaSnapshot {
  readonly acceptanceId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchName: string
  readonly consignmentReference: string
  readonly jobOrderReference: string | null
  readonly status: string
  readonly presentedQuantityKg: string
  readonly presentedKeshaCount: number | null
  readonly acceptedQuantityKg: string | null
  readonly acceptedKeshaCount: number | null
  readonly disputedQuantityKg: string | null
  readonly yieldPct: string | null
  readonly lossPct: string | null
  readonly presentedAt: Date | null
  readonly customerRepName: string | null
  readonly customerRepIdNo: string | null
  readonly signedAt: Date | null
  readonly witnessName: string | null
  readonly notes: string | null
  readonly lines: readonly MirtMerekebiyaOutputLine[]
}

function toOutputLine(row: Record<string, unknown>): MirtMerekebiyaOutputLine {
  const warehouseName = col.textOrNull(row.warehouse_name)
  const roomCode = col.textOrNull(row.room_code)
  const sectionCode = col.textOrNull(row.section_code)
  const locationLabel =
    warehouseName && roomCode && sectionCode
      ? `${warehouseName} / ${roomCode} / ${sectionCode}`
      : null

  return {
    lineNo: col.int(row.line_no),
    classificationCode: col.textOrNull(row.classification_code),
    classificationName: col.textOrNull(row.classification_name),
    lotReference: col.textOrNull(row.lot_reference),
    quantityKg: col.numeric(row.presented_quantity_kg),
    keshaCount: col.intOrNull(row.presented_kesha_count),
    locationLabel,
    lineVerdict: col.text(row.line_verdict),
  }
}

export async function loadMirtMerekebiyaSnapshot(
  tx: Tx,
  acceptanceId: string,
): Promise<MirtMerekebiyaSnapshot | undefined> {
  const headerRows = await rawRows(
    tx,
    sql`
      select
        a.id, a.reference, a.customer_id, cu.legal_name as customer_name,
        br.name_en as branch_name, cons.reference as consignment_reference,
        j.reference as job_order_reference, a.status,
        a.presented_quantity_kg, a.presented_kesha_count,
        a.accepted_quantity_kg, a.accepted_kesha_count, a.disputed_quantity_kg,
        a.yield_pct, a.loss_pct, a.presented_at,
        a.customer_rep_name, a.customer_rep_id_no, a.signed_at, a.witness_name, a.notes
      from public.acceptance_record a
      join public.customer cu on cu.id = a.customer_id
      join public.branch br on br.id = a.branch_id
      join public.consignment cons on cons.id = a.consignment_id
      left join public.job_order j on j.id = a.job_order_id
      where a.id = ${acceptanceId}::uuid
      limit 1
    `,
  )

  const header = headerRows[0]
  if (!header) return undefined

  const lineRows = await rawRows(
    tx,
    sql`
      select
        al.line_no, al.lot_id, al.presented_quantity_kg, al.presented_kesha_count, al.line_verdict,
        oc.code as classification_code, oc.name_en as classification_name,
        l.reference as lot_reference,
        loc.warehouse_name, loc.room_code, loc.section_code
      from public.acceptance_line al
      left join public.output_classification oc on oc.id = al.classification_id
      left join public.lot l on l.id = al.lot_id
      left join lateral (
        select wh.name_en as warehouse_name, rm.code as room_code, sec.code as section_code
        from public.lot_placement lp
        join public.store_section sec on sec.id = lp.location_id
        join public.store_room rm on rm.id = sec.room_id
        join public.warehouse wh on wh.id = rm.warehouse_id
        where lp.lot_id = al.lot_id
        order by lp.placed_at desc
        limit 1
      ) loc on true
      where al.acceptance_id = ${acceptanceId}::uuid
      order by al.line_no
    `,
  )

  return {
    acceptanceId: col.text(header.id),
    reference: col.text(header.reference),
    customerId: col.text(header.customer_id),
    customerName: col.text(header.customer_name),
    branchName: col.text(header.branch_name),
    consignmentReference: col.text(header.consignment_reference),
    jobOrderReference: col.textOrNull(header.job_order_reference),
    status: col.text(header.status),
    presentedQuantityKg: col.numeric(header.presented_quantity_kg),
    presentedKeshaCount: col.intOrNull(header.presented_kesha_count),
    acceptedQuantityKg: col.numericOrNull(header.accepted_quantity_kg),
    acceptedKeshaCount: col.intOrNull(header.accepted_kesha_count),
    disputedQuantityKg: col.numericOrNull(header.disputed_quantity_kg),
    yieldPct: col.numericOrNull(header.yield_pct),
    lossPct: col.numericOrNull(header.loss_pct),
    presentedAt: col.dateOrNull(header.presented_at),
    customerRepName: col.textOrNull(header.customer_rep_name),
    customerRepIdNo: col.textOrNull(header.customer_rep_id_no),
    signedAt: col.dateOrNull(header.signed_at),
    witnessName: col.textOrNull(header.witness_name),
    notes: col.textOrNull(header.notes),
    lines: lineRows.map(toOutputLine),
  }
}
