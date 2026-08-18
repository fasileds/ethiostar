import 'server-only'
import type { Tx } from '@db/client'
import { NotFoundError } from '@core/errors/app-error'
import { fileStorage } from '@platform/storage'
import { findFile, logFileAccess, type FileRecord } from '../infrastructure/file.repository'

/**
 * Authorised download.
 *
 * THE AUTHORISATION IS THE RLS TRANSACTION. `findFile` runs under the caller's claims, so a
 * customer asking for another customer's file id gets no row — and this returns 404 rather
 * than 403, because a 403 confirms the id exists (docs/architecture/05-security.md §5.2).
 *
 * A PENDING or QUARANTINED file is also 404. Not "not yet available", not "blocked" —
 * distinguishing those states to the caller leaks whether an id is real.
 */

/** How long a download link stays valid. Long enough to click, short enough not to share. */
const SIGNED_URL_TTL_SECONDS = 120

export interface DownloadContext {
  readonly actorId: string | null
  readonly ipAddress?: string | null
  readonly userAgent?: string | null
}

async function loadDownloadable(tx: Tx, fileId: string): Promise<FileRecord> {
  const file = await findFile(tx, fileId)

  if (!file || file.status !== 'AVAILABLE') {
    throw NotFoundError.of('File', fileId)
  }

  return file
}

/** A short-lived signed URL, recorded in the access log. */
export async function signedDownloadUrl(
  tx: Tx,
  fileId: string,
  context: DownloadContext,
): Promise<{ url: string; filename: string; contentType: string }> {
  const file = await loadDownloadable(tx, fileId)

  const url = await fileStorage().signedUrl(file.objectKey, SIGNED_URL_TTL_SECONDS)

  await logFileAccess(tx, file.id, context.actorId, 'SIGNED_URL_ISSUED', {
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  })

  return { url, filename: file.originalFilename, contentType: file.contentType }
}

/**
 * Stream the bytes through the application instead of redirecting.
 *
 * Used where a signed URL would be awkward — the staff document viewer, which renders the
 * file inline and must not hand the browser a URL that outlives the page.
 */
export async function downloadFileBytes(
  tx: Tx,
  fileId: string,
  context: DownloadContext,
): Promise<{ body: Buffer; filename: string; contentType: string }> {
  const file = await loadDownloadable(tx, fileId)

  const body = await fileStorage().get(file.objectKey)

  await logFileAccess(tx, file.id, context.actorId, 'DOWNLOAD', {
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  })

  return { body, filename: file.originalFilename, contentType: file.contentType }
}
