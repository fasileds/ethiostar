import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { verifyPresentedToken } from '@modules/printing'
import { PublicShell } from '@ui/layout/PublicShell'
import { When } from '@ui/patterns/DateTime'

export const metadata: Metadata = {
  title: 'Document verification',
  // Reachable by anyone holding a token off a printed page — not a page search should index.
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * The public verification page every QR code on an EthioStar document resolves to.
 *
 * "A photocopy with an altered weight then fails against the system, which is the only
 * practical defence against document tampering in a paper-first process" (Solution Overview,
 * M06). No sign-in: the gate officer or the customer scanning a bag tag is very often not a
 * system user, and that is by design (`platform/barcode/qr.ts`).
 *
 * Narrow on purpose — this confirms genuineness, it does not hand back a PDF. Someone wanting
 * the actual file needs `/api/v1/documents/[id]/pdf`, which DOES require sign-in and an
 * authorisation check, exactly like every other download in this application.
 */
export default async function ScanPage({
  params,
}: {
  readonly params: Promise<{ token: string }>
}) {
  const { token } = await params

  const headerList = await headers()
  const forwarded = headerList.get('x-forwarded-for')
  const ipAddress = forwarded?.split(',')[0]?.trim() ?? null
  const userAgent = headerList.get('user-agent')

  const verified = await verifyPresentedToken(token, { ipAddress, userAgent })
  const valid = verified.result === 'VALID'

  return (
    <PublicShell>
      <main className="container-app max-w-lg py-12">
        <div
          className={`rounded-xl p-6 shadow-sm ring-1 sm:p-8 ${
            valid
              ? 'bg-success-50 ring-success-100 dark:bg-success-900/20 dark:ring-success-900'
              : 'bg-danger-50 ring-danger-100 dark:bg-danger-900/20 dark:ring-danger-900'
          }`}
        >
          {valid ? (
            <>
              <h1 className="text-xl font-semibold text-success-700 dark:text-success-100">
                This document is genuine
              </h1>
              <dl className="mt-4 space-y-2 text-sm text-success-700 dark:text-success-100">
                <div className="flex justify-between gap-4">
                  <dt className="text-success-700/70 dark:text-success-100/70">
                    Document type
                  </dt>
                  <dd className="font-medium">{verified.documentType}</dd>
                </div>
                {verified.documentReference ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-success-700/70 dark:text-success-100/70">Reference</dt>
                    <dd className="numeric font-medium">{verified.documentReference}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4">
                  <dt className="text-success-700/70 dark:text-success-100/70">Copy</dt>
                  <dd className="font-medium">
                    {verified.copyNo}
                    {verified.isReprint ? ' (reprint)' : ' (original)'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-success-700/70 dark:text-success-100/70">Printed</dt>
                  <dd className="font-medium">
                    <When value={verified.printedAt} />
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-danger-700 dark:text-danger-100">
                We could not verify this document
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-danger-700 dark:text-danger-100">
                This code does not match any document EthioStar has issued. Treat the paper it
                came from as unverified and contact the branch that appears to have issued it.
              </p>
            </>
          )}
        </div>
      </main>
    </PublicShell>
  )
}
