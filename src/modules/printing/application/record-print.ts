import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { uuidv7 } from '@core/ids/id-generator'
import { systemClock } from '@core/clock/clock'
import { ValidationError } from '@core/errors/app-error'
import { fileStorage, buildObjectKey } from '@platform/storage'
import { generateVerificationToken, qrPngDataUri, verificationUrl } from '@platform/barcode'
import {
  countPrintsFor,
  insertPrintedDocument,
} from '../infrastructure/printed-document.repository'
import { insertGeneratedFile } from '../infrastructure/document-file.repository'

/**
 * The shared second half of every "print X" use case.
 *
 * The FIRST half — loading the source record's data and building the react-pdf element — is
 * necessarily owned by whichever module holds that data (inbound for a GRN, dispatch for a
 * gate pass, …), because `printing` sits at module tier 2 and cannot import a tier-3+ module
 * to fetch it back (eslint.config.mjs TIER). Everything from "I have a rendered buffer" onward
 * is generic, so it lives here once instead of being copied into eighteen call sites.
 */

/** Copy 1 renders clean; copy 2+ needs a reason — this is the CHECK constraint made explicit
 *  before the render happens, not after a wasted render + upload. */
export async function nextCopyNumber(
  claims: DbClaims,
  sourceType: string,
  sourceId: string,
  reprintReason: string | null,
): Promise<number> {
  const copyNo = await runInTransaction(claims, (tx) =>
    countPrintsFor(tx, sourceType, sourceId),
  )
  const next = copyNo + 1

  if (next > 1 && !reprintReason) {
    throw new ValidationError({
      message: 'A reprint requires a reason.',
      fieldErrors: [
        {
          path: 'reprintReason',
          code: 'required',
          message: 'State why this is being reprinted.',
        },
      ],
    })
  }

  return next
}

export interface PreparedVerification {
  readonly token: string
  readonly qrDataUri: string
}

/** Generated BEFORE the render, because the QR it produces is embedded in the page. */
export async function prepareVerification(appUrl: string): Promise<PreparedVerification> {
  const token = generateVerificationToken()
  const qrDataUri = await qrPngDataUri(verificationUrl(appUrl, token))
  return { token, qrDataUri }
}

export interface FinalizePrintInput {
  readonly documentType: string
  readonly sourceType: string
  readonly sourceId: string
  readonly documentReference: string | null
  readonly customerId: string | null
  readonly copyNo: number
  readonly reprintReason: string | null
  readonly verificationToken: string
  readonly printedSnapshot: unknown
  readonly buffer: Buffer
  readonly filename: string
  readonly locale: string
  readonly printedBy: string
}

export interface FinalizedPrint {
  readonly printedDocumentId: string
  readonly fileId: string
}

/**
 * Store the rendered bytes and log the print. Storage `put` is network I/O and therefore runs
 * OUTSIDE the transaction that writes the two rows (docs/architecture/06-cross-cutting.md
 * §6.3 rule 3) — an upload that fails leaves nothing behind rather than an orphaned row.
 */
export async function finalizePrint(
  claims: DbClaims,
  input: FinalizePrintInput,
): Promise<FinalizedPrint> {
  const fileId = uuidv7()
  const storage = fileStorage()
  const now = systemClock.now()
  const objectKey = buildObjectKey(input.sourceType, fileId, input.filename, now)

  await storage.put({ objectKey, body: input.buffer, contentType: 'application/pdf' })

  const { printedDocumentId } = await runInTransaction(claims, async (tx) => {
    await insertGeneratedFile(tx, {
      id: fileId,
      bucket: storage.bucket,
      objectKey,
      originalFilename: input.filename,
      contentType: 'application/pdf',
      byteSize: input.buffer.byteLength,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      actorId: input.printedBy,
    })

    const printed = await insertPrintedDocument(tx, {
      documentType: input.documentType,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      documentReference: input.documentReference,
      customerId: input.customerId,
      copyNo: input.copyNo,
      reprintReason: input.reprintReason,
      verificationToken: input.verificationToken,
      printedSnapshot: input.printedSnapshot,
      fileId,
      objectKey,
      locale: input.locale,
      printedBy: input.printedBy,
    })

    return { printedDocumentId: printed.id }
  })

  return { printedDocumentId, fileId }
}
