import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { recentPrints, type PrintLogRow } from '@modules/printing'
import { PageHeader, Card, CardHeader, EmptyState } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'
import { buttonClass } from '@ui/primitives/Button'

export const metadata: Metadata = { title: 'Documents' }

/**
 * The customer's documents.
 *
 * Files are NOT served by public URL. Each download mints a signed URL per request, after the
 * same authorisation check the owning record uses — an object key is not a permission, and a
 * link that stays valid after it is forwarded is a leak with a delay on it.
 *
 * That is why this page lists documents rather than embedding them: the href is generated at
 * the moment of the click, not at the moment of the render.
 */
export default async function PortalDocumentsPage() {
  const { readiness } = await pageContext()

  // RLS scopes printed_document to staff OR the owning customer (migration 0029's
  // `p_printed_document__customer` policy), so this naturally returns only this customer's
  // own documents without the query filtering by customer id itself.
  const documents = await pageQuery([] as PrintLogRow[], (tx) => recentPrints(tx, 50))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Goods receipts, acceptance certificates and delivery notes issued on your account."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Issued documents"
            description="Each carries a QR code. Scanning it confirms the copy you hold matches the record."
          />
        </div>

        {documents.length === 0 ? (
          <div className="px-4 pb-5 sm:px-5">
            <EmptyState
              title="No documents yet"
              description="Documents appear here as EthioStar issues them — a goods receipt when coffee arrives, an acceptance certificate when you sign for output, a delivery note when it leaves."
              icon={<Icon name="documents" className="size-8" />}
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
              >
                <span className="shrink-0 text-[var(--text-tertiary)]">
                  <Icon name="documents" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{document.documentType}</p>
                  <p className="numeric truncate text-xs text-[var(--text-tertiary)]">
                    {document.documentReference ?? ''}
                    {document.copyNo > 1 ? ` · copy ${document.copyNo}` : ''}
                  </p>
                </div>
                <When
                  value={document.printedAt}
                  className="shrink-0 text-xs text-[var(--text-tertiary)]"
                />
                <a
                  href={`/api/v1/documents/${document.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass({ variant: 'secondary', size: 'sm' })}
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
