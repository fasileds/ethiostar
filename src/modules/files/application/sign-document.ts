import 'server-only'
import { createHash } from 'node:crypto'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { NotFoundError, ValidationError } from '@core/errors/app-error'
import { fileStorage } from '@platform/storage'
import { findFile } from '../infrastructure/file.repository'
import {
  insertDocumentSignature,
  listDocumentSignatures,
  insertDocumentVersion,
  listDocumentVersions,
  type DocumentSignatureRow,
  type DocumentVersionRow,
} from '../infrastructure/document-signature.repository'

/**
 * M05 — signature capture and version history.
 *
 * SCOPE: `acceptance_record` already has its own customer-facing signing flow (M16 Mirt
 * Merekebiya — the customer signs directly in the portal, docs/phase-1/scope.md B5). This
 * module generalises that pattern to ANY document, but is scoped to STAFF-RECORDED signatures
 * for now — a staff member scanning a wet-ink signed contract, or capturing a signature during
 * an in-person visit. A customer self-serve e-sign portal flow needs its own RLS policy design
 * and is a deliberate fast-follow, not covered here (`document_signature` is staff-only, `FOR
 * ALL` via `fn_is_staff()`).
 */

export interface CaptureSignatureInput {
  readonly fileId: string
  readonly sourceType: string
  readonly sourceId: string
  readonly signerUserId: string | null
  readonly signerName: string
  readonly signerRole: string | null
  readonly method: 'DRAWN' | 'TYPED' | 'CLICK'
  readonly signatureData: string | null
  readonly ipAddress: string | null
  readonly userAgent: string | null
  readonly actorId: string
}

/**
 * The content hash proves what the signer was shown. `stored_file.checksum_sha256` is set at
 * upload time and covers the exact bytes that will ever live at that object key, so reusing it
 * avoids re-reading a potentially large PDF; only a legacy row without a checksum falls back
 * to hashing the stored bytes directly.
 */
async function contentHashFor(file: {
  readonly checksumSha256: string | null
  readonly objectKey: string
}): Promise<string> {
  if (file.checksumSha256) return file.checksumSha256

  const bytes = await fileStorage().get(file.objectKey)
  return createHash('sha256').update(bytes).digest('hex')
}

export async function captureSignature(
  claims: DbClaims,
  input: CaptureSignatureInput,
): Promise<{ signatureId: string }> {
  return runInTransaction(claims, async (tx) => {
    const file = await findFile(tx, input.fileId)
    if (!file || file.status !== 'AVAILABLE') {
      throw NotFoundError.of('File', input.fileId)
    }

    if ((input.method === 'DRAWN' || input.method === 'TYPED') && !input.signatureData) {
      throw new ValidationError({
        fieldErrors: [
          {
            path: 'signatureData',
            code: 'required',
            message: 'Signature data is required for this method.',
          },
        ],
      })
    }

    const contentHash = await contentHashFor(file)

    const inserted = await insertDocumentSignature(tx, {
      fileId: input.fileId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      signerUserId: input.signerUserId,
      signerName: input.signerName,
      signerRole: input.signerRole,
      method: input.method,
      signatureData: input.signatureData,
      contentHash,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      actorId: input.actorId,
    })

    return { signatureId: inserted.id }
  })
}

/** For showing "signed by X on Y" on a document. */
export async function listSignaturesFor(
  tx: Tx,
  sourceType: string,
  sourceId: string,
): Promise<DocumentSignatureRow[]> {
  return listDocumentSignatures(tx, sourceType, sourceId)
}

export interface CreateDocumentVersionInput {
  readonly documentGroupId: string
  readonly fileId: string
  readonly versionNo: number
  readonly changeNote: string | null
  readonly actorId: string
}

/** Record a new edition of a logical document — a contract or a template revision. */
export async function createDocumentVersion(
  claims: DbClaims,
  input: CreateDocumentVersionInput,
): Promise<void> {
  await runInTransaction(claims, (tx) => insertDocumentVersion(tx, input))
}

export async function listVersionHistory(
  tx: Tx,
  documentGroupId: string,
): Promise<DocumentVersionRow[]> {
  return listDocumentVersions(tx, documentGroupId)
}
