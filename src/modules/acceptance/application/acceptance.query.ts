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
 * M16 read models.
 *
 * The queue that matters is PRESENTED: output shown to a customer who has not yet signed.
 * Coffee sitting there is coffee nobody can dispatch and nobody has agreed on, so it is the
 * figure the dashboard counts and the first tab of the list.
 */

export interface AcceptanceRow {
  readonly id: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly consignmentId: string
  readonly consignmentReference: string
  readonly jobOrderReference: string | null
  readonly status: string
  readonly presentedQuantityKg: string
  readonly presentedKeshaCount: number | null
  readonly acceptedQuantityKg: string | null
  readonly acceptedKeshaCount: number | null
  readonly disputedQuantityKg: string | null
  readonly yieldPct: string | null
  readonly customerRepName: string | null
  readonly presentedAt: Date | null
  readonly signedAt: Date | null
  readonly disputeReason: string | null
  readonly createdAt: Date
}

function toAcceptance(row: Record<string, unknown>): AcceptanceRow {
  return {
    id: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    consignmentId: col.text(row.consignment_id),
    consignmentReference: col.text(row.consignment_reference),
    jobOrderReference: col.textOrNull(row.job_order_reference),
    status: col.text(row.status),
    presentedQuantityKg: col.numeric(row.presented_quantity_kg),
    presentedKeshaCount: col.intOrNull(row.presented_kesha_count),
    acceptedQuantityKg: col.numericOrNull(row.accepted_quantity_kg),
    acceptedKeshaCount: col.intOrNull(row.accepted_kesha_count),
    disputedQuantityKg: col.numericOrNull(row.disputed_quantity_kg),
    yieldPct: col.numericOrNull(row.yield_pct),
    customerRepName: col.textOrNull(row.customer_rep_name),
    presentedAt: col.dateOrNull(row.presented_at),
    signedAt: col.dateOrNull(row.signed_at),
    disputeReason: col.textOrNull(row.dispute_reason),
    createdAt: col.date(row.created_at),
  }
}

export async function listAcceptances(
  tx: Tx,
  filters: {
    status?: string | undefined
    search?: string | undefined
    customerId?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<AcceptanceRow>> {
  const limit = listLimit(filters.limit)
  const search = filters.search?.trim()

  const rows = await rawRows(
    tx,
    sql`
      select
        a.*,
        cu.legal_name  as customer_name,
        cons.reference as consignment_reference,
        j.reference    as job_order_reference
      from public.acceptance_record a
      join public.customer cu      on cu.id = a.customer_id
      join public.consignment cons on cons.id = a.consignment_id
      left join public.job_order j on j.id = a.job_order_id
      where 1 = 1
        ${filters.status ? sql`and a.status = ${filters.status}` : sql``}
        ${filters.customerId ? sql`and a.customer_id = ${filters.customerId}::uuid` : sql``}
        ${
          search
            ? sql`and (a.reference ilike ${'%' + search + '%'}
                    or cons.reference ilike ${'%' + search + '%'}
                    or cu.legal_name ilike ${'%' + search + '%'})`
            : sql``
        }
        ${keysetBefore(sql`a.created_at`, sql`a.id`, filters.cursor)}
      order by a.created_at desc, a.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(rows.map(toAcceptance), limit, (row) => ({
    sortValue: cursorValue(row.createdAt),
    id: row.id,
  }))
}

export async function acceptanceStatusCounts(
  tx: Tx,
  customerId?: string,
): Promise<Readonly<Record<string, number>>> {
  const rows = await rawRows(
    tx,
    sql`
      select status, count(*)::int as total
      from public.acceptance_record
      where 1 = 1 ${customerId ? sql`and customer_id = ${customerId}::uuid` : sql``}
      group by status
    `,
  )
  return Object.fromEntries(rows.map((row) => [col.text(row.status), col.int(row.total)]))
}

export interface AcceptanceDetail extends AcceptanceRow {
  readonly lossPct: string | null
  readonly customerRepIdNo: string | null
  readonly witnessName: string | null
  readonly presentedByName: string | null
  readonly disputeRaisedAt: Date | null
  readonly disputeResolvedAt: Date | null
  readonly disputeResolution: string | null
  readonly supersedesId: string | null
  readonly supersededReason: string | null
  readonly signatureFileId: string | null
  readonly closedAt: Date | null
  readonly notes: string | null
}

export async function findAcceptance(
  tx: Tx,
  id: string,
): Promise<AcceptanceDetail | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        a.*,
        cu.legal_name  as customer_name,
        cons.reference as consignment_reference,
        j.reference    as job_order_reference,
        p.full_name    as presented_by_name
      from public.acceptance_record a
      join public.customer cu      on cu.id = a.customer_id
      join public.consignment cons on cons.id = a.consignment_id
      left join public.job_order j on j.id = a.job_order_id
      left join public.app_user p on p.id = a.presented_by
      where a.id = ${id}::uuid
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    ...toAcceptance(row),
    lossPct: col.numericOrNull(row.loss_pct),
    customerRepIdNo: col.textOrNull(row.customer_rep_id_no),
    witnessName: col.textOrNull(row.witness_name),
    presentedByName: col.textOrNull(row.presented_by_name),
    disputeRaisedAt: col.dateOrNull(row.dispute_raised_at),
    disputeResolvedAt: col.dateOrNull(row.dispute_resolved_at),
    disputeResolution: col.textOrNull(row.dispute_resolution),
    supersedesId: col.textOrNull(row.supersedes_id),
    supersededReason: col.textOrNull(row.superseded_reason),
    signatureFileId: col.textOrNull(row.signature_file_id),
    closedAt: col.dateOrNull(row.closed_at),
    notes: col.textOrNull(row.notes),
  }
}

export interface AcceptanceLineRow {
  readonly id: string
  readonly lineNo: number
  readonly classificationName: string | null
  readonly lotReference: string | null
  readonly presentedQuantityKg: string
  readonly presentedKeshaCount: number | null
  readonly acceptedQuantityKg: string | null
  readonly acceptedKeshaCount: number | null
  readonly lineVerdict: string
  readonly remark: string | null
}

export async function acceptanceLines(
  tx: Tx,
  acceptanceId: string,
): Promise<AcceptanceLineRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        al.id, al.line_no, al.presented_quantity_kg, al.presented_kesha_count,
        al.accepted_quantity_kg, al.accepted_kesha_count, al.line_verdict, al.remark,
        oc.name_en  as classification_name,
        l.reference as lot_reference
      from public.acceptance_line al
      left join public.output_classification oc on oc.id = al.classification_id
      left join public.lot l on l.id = al.lot_id
      where al.acceptance_id = ${acceptanceId}::uuid
      order by al.line_no
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    lineNo: col.int(row.line_no),
    classificationName: col.textOrNull(row.classification_name),
    lotReference: col.textOrNull(row.lot_reference),
    presentedQuantityKg: col.numeric(row.presented_quantity_kg),
    presentedKeshaCount: col.intOrNull(row.presented_kesha_count),
    acceptedQuantityKg: col.numericOrNull(row.accepted_quantity_kg),
    acceptedKeshaCount: col.intOrNull(row.accepted_kesha_count),
    lineVerdict: col.text(row.line_verdict),
    remark: col.textOrNull(row.remark),
  }))
}
