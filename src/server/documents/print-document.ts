import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { env } from '@config/env'
import type { Locale } from '@config/constants'
import type { Actor } from '@modules/identity'
import { NotFoundError } from '@core/errors/app-error'
import { systemClock } from '@core/clock/clock'
import { documentRenderer } from '@platform/pdf'
import { nextCopyNumber, prepareVerification, finalizePrint } from '@modules/printing'
import { DOCUMENT_REGISTRY, type RegisteredDocumentType } from './registry'

/**
 * Print one document — the single entry point every "Print" button in the app calls.
 *
 * Four steps, and the order matters (docs/adr/0012-pdf-rendering.md):
 *   1. LOAD    the source record's data, inside a short transaction.
 *   2. NUMBER  the copy (1st print vs a reprint), before anything expensive happens.
 *   3. RENDER  outside any transaction — a render holds CPU for tens to hundreds of ms.
 *   4. RECORD  the file and the print-log row (modules/printing/application/record-print.ts).
 */

export interface PrintDocumentInput {
  readonly documentType: RegisteredDocumentType
  readonly sourceId: string
  readonly locale?: Locale
  readonly reprintReason?: string | null
}

export interface PrintDocumentResult {
  readonly printedDocumentId: string
  readonly fileId: string
  readonly documentReference: string | null
}

/** Confirmed with the client but never finalised in the source document (see primitives.tsx
 *  `Letterhead` comment) — kept here, in ONE place, until that is settled. */
const ORGANISATION_NAME = 'EthioStar'

export async function printDocument(
  claims: DbClaims,
  actor: Actor,
  input: PrintDocumentInput,
): Promise<PrintDocumentResult> {
  const entry = DOCUMENT_REGISTRY[input.documentType]
  if (!entry) {
    throw NotFoundError.of('Document type', input.documentType)
  }

  const locale = input.locale ?? 'en'

  const loaded = await runInTransaction(claims, (tx) => entry.load(tx, input.sourceId))
  if (!loaded) throw NotFoundError.of('Document source', input.sourceId)

  const copyNo = await nextCopyNumber(
    claims,
    entry.sourceType,
    input.sourceId,
    input.reprintReason ?? null,
  )
  const { token, qrDataUri } = await prepareVerification(env.APP_URL)

  const buffer = await documentRenderer().render(
    loaded.element({
      organisationName: ORGANISATION_NAME,
      qrDataUri,
      locale,
      copyNo,
      printedAt: systemClock.now(),
      printedByName: actor.fullName,
    }),
    locale,
  )

  const filename = `${(loaded.documentReference ?? input.documentType).replace(/[^\w-]+/g, '-')}-copy${copyNo}.pdf`

  const { printedDocumentId, fileId } = await finalizePrint(claims, {
    documentType: input.documentType,
    sourceType: entry.sourceType,
    sourceId: input.sourceId,
    documentReference: loaded.documentReference,
    customerId: loaded.customerId,
    copyNo,
    reprintReason: input.reprintReason ?? null,
    verificationToken: token,
    printedSnapshot: loaded.snapshot,
    buffer,
    filename,
    locale,
    printedBy: actor.userId,
  })

  return { printedDocumentId, fileId, documentReference: loaded.documentReference }
}
