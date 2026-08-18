import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

/**
 * `printed_document` persistence — the append-only print log (M06 key control).
 *
 * Deliberately narrow: this file knows nothing about goods receipts, gate passes or any other
 * source record. Everything it needs arrives already assembled by the caller (see
 * `application/record-print.ts`), which is what lets the higher-tier modules that actually own
 * document data (inbound, dispatch, acceptance, …) print without `printing` ever importing
 * them back — the module tiering in eslint.config.mjs only allows imports downward.
 */

/** How many times this source has already been printed, so the caller can compute copyNo. */
export async function countPrintsFor(
  tx: Tx,
  sourceType: string,
  sourceId: string,
): Promise<number> {
  const rows = await rawRows(
    tx,
    sql`
      select count(*)::int as n
      from public.printed_document
      where source_type = ${sourceType} and source_id = ${sourceId}::uuid
    `,
  )
  return col.int(rows[0]?.n ?? 0)
}

export interface InsertPrintedDocumentInput {
  readonly documentType: string
  readonly sourceType: string
  readonly sourceId: string
  readonly documentReference: string | null
  readonly customerId: string | null
  readonly copyNo: number
  readonly reprintReason: string | null
  readonly verificationToken: string
  readonly printedSnapshot: unknown
  readonly fileId: string
  readonly objectKey: string
  readonly locale: string
  readonly printedBy: string
}

export interface InsertedPrintedDocument {
  readonly id: string
}

export async function insertPrintedDocument(
  tx: Tx,
  input: InsertPrintedDocumentInput,
): Promise<InsertedPrintedDocument> {
  const id = uuidv7()

  await tx.execute(sql`
    insert into public.printed_document (
      id, document_type, source_type, source_id, document_reference, customer_id,
      copy_no, reprint_reason, verification_token, printed_snapshot, file_id, object_key,
      locale, printed_by, printed_at, created_at
    ) values (
      ${id}, ${input.documentType}, ${input.sourceType}, ${input.sourceId}::uuid,
      ${input.documentReference}, ${input.customerId}::uuid,
      ${input.copyNo}, ${input.reprintReason}, ${input.verificationToken},
      ${JSON.stringify(input.printedSnapshot)}::jsonb, ${input.fileId}::uuid, ${input.objectKey},
      ${input.locale}, ${input.printedBy}::uuid, now(), now()
    )
  `)

  return { id }
}

export interface PrintedDocumentRecord {
  readonly id: string
  readonly documentType: string
  readonly sourceType: string
  readonly sourceId: string
  readonly documentReference: string | null
  readonly customerId: string | null
  readonly copyNo: number
  readonly fileId: string | null
  readonly objectKey: string
  readonly locale: string
  readonly printedAt: Date
}

/** Runs under the caller's RLS transaction — staff see any row, a customer only their own. */
export async function findPrintedDocument(
  tx: Tx,
  id: string,
): Promise<PrintedDocumentRecord | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select id, document_type, source_type, source_id, document_reference, customer_id,
             copy_no, file_id, object_key, locale, printed_at
      from public.printed_document
      where id = ${id}::uuid
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    id: col.text(row.id),
    documentType: col.text(row.document_type),
    sourceType: col.text(row.source_type),
    sourceId: col.text(row.source_id),
    documentReference: col.textOrNull(row.document_reference),
    customerId: col.textOrNull(row.customer_id),
    copyNo: col.int(row.copy_no),
    fileId: col.textOrNull(row.file_id),
    objectKey: col.text(row.object_key),
    locale: col.text(row.locale),
    printedAt: col.date(row.printed_at),
  }
}
