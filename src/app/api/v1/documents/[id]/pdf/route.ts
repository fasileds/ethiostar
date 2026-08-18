import { NextResponse } from 'next/server'
import { requireActor, currentClaims } from '@server/auth/dal'
import { runInTransaction } from '@db/transaction'
import { fileStorage } from '@platform/storage'
import { findPrintedDocument } from '@modules/printing'
import { NotFoundError, toAppError } from '@core/errors/app-error'

/**
 * `GET /api/v1/documents/[id]/pdf` — the first REST route in this codebase (see
 * `src/server/documents/print-document.ts` for why the orchestration lives at `server/` tier).
 *
 * Files are never served by public URL (docs/architecture pattern already followed by
 * `modules/files/application/download-file.ts`): this checks authorisation, then REDIRECTS to
 * a short-lived signed URL rather than proxying the bytes itself, so the route stays cheap
 * and a copied link stops working within minutes.
 *
 * THE AUTHORISATION IS THE RLS TRANSACTION. `findPrintedDocument` runs under the caller's
 * claims, so a customer asking for another customer's printed document — or another
 * customer's own document id — gets no row, and this returns 404 rather than 403: a 403
 * confirms the id exists (docs/architecture/05-security.md §5.2).
 */

const SIGNED_URL_TTL_SECONDS = 120

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params

  try {
    const actor = await requireActor()
    const claims = await currentClaims()

    const doc = await runInTransaction(claims, (tx) => findPrintedDocument(tx, id))
    if (!doc) throw NotFoundError.of('Document', id)

    void actor // authorisation already enforced by the RLS-scoped query above

    const url = await fileStorage().signedUrl(doc.objectKey, SIGNED_URL_TTL_SECONDS)
    return NextResponse.redirect(url)
  } catch (error) {
    const appError = toAppError(error)
    return NextResponse.json(
      { code: appError.code, message: appError.message },
      { status: appError.httpStatus },
    )
  }
}
