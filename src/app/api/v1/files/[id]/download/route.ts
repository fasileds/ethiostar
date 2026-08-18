import { NextResponse } from 'next/server'
import { requireActor, currentClaims } from '@server/auth/dal'
import { runInTransaction } from '@db/transaction'
import { signedDownloadUrl } from '@modules/files'
import { toAppError } from '@core/errors/app-error'

/**
 * `GET /api/v1/files/[id]/download` — hands back a short-lived signed URL for a `stored_file`
 * as JSON, so KYC documents (and any other uploaded file) can be opened from an in-page
 * preview instead of requiring the reviewer to trust the filename alone before verifying it.
 *
 * JSON rather than a redirect: the caller points an `<iframe>` at the returned URL directly.
 * A redirect would carry this route's own `frame-ancestors 'none'` / `X-Frame-Options: DENY`
 * headers (set on every response in `proxy.ts`) into the framing navigation and get blocked
 * before ever reaching Supabase storage.
 *
 * THE AUTHORISATION IS THE RLS TRANSACTION, same pattern as the printed-document route:
 * `signedDownloadUrl` -> `findFile` runs under the caller's claims, so a request for a file
 * outside the caller's access returns 404 rather than 403.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params

  try {
    const actor = await requireActor()
    const claims = await currentClaims()

    const { url, filename, contentType } = await runInTransaction(claims, (tx) =>
      signedDownloadUrl(tx, id, { actorId: actor.userId }),
    )

    return NextResponse.json({ url, filename, contentType })
  } catch (error) {
    const appError = toAppError(error)
    return NextResponse.json(
      { code: appError.code, message: appError.message },
      { status: appError.httpStatus },
    )
  }
}
