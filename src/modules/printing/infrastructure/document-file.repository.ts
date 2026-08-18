import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'

/**
 * `stored_file` rows for RENDERED documents specifically.
 *
 * `modules/files` owns the general upload path (verify → reserve PENDING → scan → publish
 * AVAILABLE), but that dance exists because a USER-supplied upload is attacker-controlled
 * bytes. A PDF this application just rendered from its own data is neither unverified nor
 * unscanned in any meaningful sense — magic-byte checking our own `%PDF-` output and virus
 * scanning our own renderer's buffer would be theatre, not a control. So this module writes
 * `stored_file` directly, AVAILABLE from the moment the bytes are known to be on the bucket.
 *
 * `printing` cannot import `modules/files` regardless (both sit at module tier 2 — see
 * eslint.config.mjs; same-tier imports are forbidden by design), so this narrow duplication is
 * also the architecturally correct shape, not just a convenience.
 */

export interface InsertGeneratedFileInput {
  readonly id: string
  readonly bucket: string
  readonly objectKey: string
  readonly originalFilename: string
  readonly contentType: string
  readonly byteSize: number
  readonly sourceType: string
  readonly sourceId: string
  readonly actorId: string
}

export async function insertGeneratedFile(
  tx: Tx,
  input: InsertGeneratedFileInput,
): Promise<void> {
  await tx.execute(sql`
    insert into public.stored_file (
      id, bucket, object_key, original_filename, content_type, byte_size,
      source_type, source_id, category, status, uploaded_at,
      created_by, created_at, updated_at
    ) values (
      ${input.id}, ${input.bucket}, ${input.objectKey}, ${input.originalFilename},
      ${input.contentType}, ${input.byteSize},
      ${input.sourceType}, ${input.sourceId}::uuid, 'REPORT', 'AVAILABLE', now(),
      ${input.actorId}::uuid, now(), now()
    )
  `)
}
