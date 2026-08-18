import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * M06 read models.
 *
 * The print log is append-only and carries a per-document copy number, so a reprint is
 * visible AS a reprint. "Who printed the third copy of this goods receipt, and why" is a
 * question that comes up in disputes, and a system that cannot answer it is no better than
 * the stack of paper it replaced.
 */

export interface PrintLogRow {
  readonly id: string
  readonly documentType: string
  readonly documentReference: string | null
  readonly copyNo: number
  readonly reprintReason: string | null
  readonly printedByName: string | null
  readonly printedAt: Date
  readonly locale: string
}

export async function recentPrints(tx: Tx, limit = 50): Promise<PrintLogRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        p.id, p.document_type, p.document_reference, p.copy_no, p.reprint_reason,
        p.printed_at, p.locale,
        u.full_name as printed_by_name
      from public.printed_document p
      left join public.app_user u on u.id = p.printed_by
      order by p.printed_at desc
      limit ${limit}
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    documentType: col.text(row.document_type),
    documentReference: col.textOrNull(row.document_reference),
    copyNo: col.int(row.copy_no),
    reprintReason: col.textOrNull(row.reprint_reason),
    printedByName: col.textOrNull(row.printed_by_name),
    printedAt: col.date(row.printed_at),
    locale: col.text(row.locale),
  }))
}
