import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

/**
 * `document_signature` and `document_version_history` persistence — M05 e-signature.
 *
 * Both tables are staff-only (RLS `FOR ALL` via `fn_is_staff()`); nothing here decides who
 * may call it, that is `withAction`'s job via the `document:sign` / `document:manage_versions`
 * permissions.
 */

export interface InsertDocumentSignatureInput {
  readonly fileId: string
  readonly sourceType: string
  readonly sourceId: string
  readonly signerUserId: string | null
  readonly signerName: string
  readonly signerRole: string | null
  readonly method: 'DRAWN' | 'TYPED' | 'CLICK'
  readonly signatureData: string | null
  readonly contentHash: string
  readonly ipAddress: string | null
  readonly userAgent: string | null
  readonly actorId: string
}

export async function insertDocumentSignature(
  tx: Tx,
  input: InsertDocumentSignatureInput,
): Promise<{ id: string }> {
  const id = uuidv7()

  await tx.execute(sql`
    insert into public.document_signature (
      id, file_id, source_type, source_id, signer_user_id, signer_name, signer_role,
      method, signature_data, content_hash, ip_address, user_agent, signed_at,
      created_by, created_at
    ) values (
      ${id}, ${input.fileId}::uuid, ${input.sourceType}, ${input.sourceId}::uuid,
      ${input.signerUserId}::uuid, ${input.signerName}, ${input.signerRole},
      ${input.method}, ${input.signatureData}, ${input.contentHash},
      ${input.ipAddress}, ${input.userAgent}, now(),
      ${input.actorId}::uuid, now()
    )
  `)

  return { id }
}

export interface DocumentSignatureRow {
  readonly id: string
  readonly fileId: string
  readonly sourceType: string
  readonly sourceId: string
  readonly signerName: string
  readonly signerRole: string | null
  readonly method: string
  readonly contentHash: string
  readonly signedAt: Date
}

/** For showing "signed by X on Y" on a document. */
export async function listDocumentSignatures(
  tx: Tx,
  sourceType: string,
  sourceId: string,
): Promise<DocumentSignatureRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, file_id, source_type, source_id, signer_name, signer_role, method,
             content_hash, signed_at
      from public.document_signature
      where source_type = ${sourceType} and source_id = ${sourceId}::uuid
      order by signed_at
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    fileId: col.text(row.file_id),
    sourceType: col.text(row.source_type),
    sourceId: col.text(row.source_id),
    signerName: col.text(row.signer_name),
    signerRole: col.textOrNull(row.signer_role),
    method: col.text(row.method),
    contentHash: col.text(row.content_hash),
    signedAt: col.date(row.signed_at),
  }))
}

export interface InsertDocumentVersionInput {
  readonly documentGroupId: string
  readonly fileId: string
  readonly versionNo: number
  readonly changeNote: string | null
  readonly actorId: string
}

export async function insertDocumentVersion(
  tx: Tx,
  input: InsertDocumentVersionInput,
): Promise<void> {
  await tx.execute(sql`
    insert into public.document_version_history (
      id, document_group_id, file_id, version_no, change_note, created_by, created_at
    ) values (
      ${uuidv7()}, ${input.documentGroupId}::uuid, ${input.fileId}::uuid, ${input.versionNo},
      ${input.changeNote}, ${input.actorId}::uuid, now()
    )
  `)
}

export interface DocumentVersionRow {
  readonly id: string
  readonly documentGroupId: string
  readonly fileId: string
  readonly versionNo: number
  readonly changeNote: string | null
  readonly createdAt: Date
}

export async function listDocumentVersions(
  tx: Tx,
  documentGroupId: string,
): Promise<DocumentVersionRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, document_group_id, file_id, version_no, change_note, created_at
      from public.document_version_history
      where document_group_id = ${documentGroupId}::uuid
      order by version_no
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    documentGroupId: col.text(row.document_group_id),
    fileId: col.text(row.file_id),
    versionNo: col.int(row.version_no),
    changeNote: col.textOrNull(row.change_note),
    createdAt: col.date(row.created_at),
  }))
}
