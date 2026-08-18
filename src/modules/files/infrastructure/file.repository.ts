import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * `stored_file` persistence.
 *
 * The status machine is PENDING → AVAILABLE | QUARANTINED → DELETED, and every transition
 * is a separate short transaction because scanning and uploading are I/O that must not
 * happen inside one.
 */

export interface InsertFileInput {
  readonly id: string
  readonly bucket: string
  readonly objectKey: string
  readonly originalFilename: string
  readonly contentType: string
  readonly byteSize: number
  readonly checksumSha256: string
  readonly sourceType: string
  readonly sourceId: string | null
  readonly category: string
  readonly actorId: string
}

/** Write the metadata row PENDING, before any bytes move. */
export async function insertPendingFile(tx: Tx, input: InsertFileInput): Promise<void> {
  await tx.execute(sql`
    insert into public.stored_file (
      id, bucket, object_key, original_filename, content_type, byte_size, checksum_sha256,
      source_type, source_id, category, status,
      created_by, created_at, updated_at
    ) values (
      ${input.id}, ${input.bucket}, ${input.objectKey}, ${input.originalFilename},
      ${input.contentType}, ${input.byteSize}, ${input.checksumSha256},
      ${input.sourceType}, ${input.sourceId}::uuid, ${input.category}, 'PENDING',
      ${input.actorId}::uuid, now(), now()
    )
  `)
}

export async function markFileAvailable(tx: Tx, id: string, actorId: string): Promise<void> {
  await tx.execute(sql`
    update public.stored_file
    set status = 'AVAILABLE', uploaded_at = now(), updated_at = now(),
        updated_by = ${actorId}::uuid, version = version + 1
    where id = ${id} and status = 'PENDING'
  `)
}

/**
 * Quarantine a file.
 *
 * The reason is kept on the row rather than only in a log: months later, "why was this
 * applicant's licence rejected?" must be answerable from the record.
 */
export async function markFileQuarantined(
  tx: Tx,
  id: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.stored_file
    set status = 'QUARANTINED', quarantine_reason = ${reason}, updated_at = now(),
        updated_by = ${actorId}::uuid, version = version + 1
    where id = ${id}
  `)
}

export interface FileRecord {
  readonly id: string
  readonly bucket: string
  readonly objectKey: string
  readonly originalFilename: string
  readonly contentType: string
  readonly byteSize: number | null
  readonly checksumSha256: string | null
  readonly status: string
  readonly sourceType: string
  readonly sourceId: string | null
  readonly category: string
}

/**
 * Load one file's metadata.
 *
 * Runs under the caller's RLS transaction, so a customer probing another customer's file id
 * gets nothing back and the caller turns that into a 404 — never a 403, which would confirm
 * the id exists.
 */
export async function findFile(tx: Tx, id: string): Promise<FileRecord | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select id, bucket, object_key, original_filename, content_type, byte_size,
             checksum_sha256, status, source_type, source_id, category
      from public.stored_file
      where id = ${id} and deleted_at is null
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    id: col.text(row.id),
    bucket: col.text(row.bucket),
    objectKey: col.text(row.object_key),
    originalFilename: col.text(row.original_filename),
    contentType: col.text(row.content_type),
    byteSize: col.intOrNull(row.byte_size),
    checksumSha256: col.textOrNull(row.checksum_sha256),
    status: col.text(row.status),
    sourceType: col.text(row.source_type),
    sourceId: col.textOrNull(row.source_id),
    category: col.text(row.category),
  }
}

/** Files attached to one record — the document list on an application or a consignment. */
export async function listFilesFor(
  tx: Tx,
  sourceType: string,
  sourceId: string,
): Promise<FileRecord[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, bucket, object_key, original_filename, content_type, byte_size,
             checksum_sha256, status, source_type, source_id, category
      from public.stored_file
      where source_type = ${sourceType} and source_id = ${sourceId}::uuid
        and deleted_at is null
        and status <> 'QUARANTINED'
      order by created_at
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    bucket: col.text(row.bucket),
    objectKey: col.text(row.object_key),
    originalFilename: col.text(row.original_filename),
    contentType: col.text(row.content_type),
    byteSize: col.intOrNull(row.byte_size),
    checksumSha256: col.textOrNull(row.checksum_sha256),
    status: col.text(row.status),
    sourceType: col.text(row.source_type),
    sourceId: col.textOrNull(row.source_id),
    category: col.text(row.category),
  }))
}

/** Access logging. Append-only by design — see the schema comment on `file_access_log`. */
export async function logFileAccess(
  tx: Tx,
  fileId: string,
  actorId: string | null,
  action: 'VIEW' | 'DOWNLOAD' | 'SIGNED_URL_ISSUED',
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  await tx.execute(sql`
    insert into public.file_access_log (id, file_id, actor_id, action, ip_address, user_agent)
    values (gen_random_uuid(), ${fileId}, ${actorId}::uuid, ${action},
            ${context.ipAddress ?? null}, ${context.userAgent ?? null})
  `)
}
