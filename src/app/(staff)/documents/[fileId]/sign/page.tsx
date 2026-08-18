import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pageContext, pageQuery } from '@server/page-data'
import {
  findFile,
  listSignaturesFor,
  listVersionHistory,
  type DocumentSignatureRow,
  type DocumentVersionRow,
} from '@modules/files'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { When } from '@ui/patterns/DateTime'
import { SignDocumentForm } from './SignDocumentForm'

export const metadata: Metadata = { title: 'Sign document' }

/**
 * M05 — the general-purpose signing entry point.
 *
 * `modules/contracts` (M10) is being built in parallel and does not exist yet; this screen
 * lets staff sign ANY file by id in the meantime, and is what other Phase-2 modules link to
 * via `/documents/<fileId>/sign?sourceType=...&sourceId=...` once they have records of their
 * own to attach signatures to.
 */
export default async function SignDocumentPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ fileId: string }>
  readonly searchParams: Promise<{
    sourceType?: string
    sourceId?: string
    documentGroupId?: string
  }>
}) {
  const { fileId } = await params
  const search = await searchParams
  const { readiness } = await pageContext()

  if (!readiness.ready) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sign document" />
        <Card>Database is not ready.</Card>
      </div>
    )
  }

  const file = await pageQuery(undefined, (tx) => findFile(tx, fileId))
  if (!file) notFound()

  const sourceType = search.sourceType ?? file.sourceType
  const sourceId = search.sourceId ?? file.sourceId ?? fileId
  const documentGroupId = search.documentGroupId

  const [signatures, versions] = await Promise.all([
    pageQuery([] as DocumentSignatureRow[], (tx) =>
      listSignaturesFor(tx, sourceType, sourceId),
    ),
    documentGroupId
      ? pageQuery([] as DocumentVersionRow[], (tx) => listVersionHistory(tx, documentGroupId))
      : Promise.resolve([] as DocumentVersionRow[]),
  ])

  return (
    <div className="space-y-6">
      <PageHeader title="Sign document" description={file.originalFilename} />

      <Card>
        <CardHeader
          title="Capture signature"
          description={`Recording a signature against ${file.originalFilename}.`}
        />
        <div className="mt-4">
          <SignDocumentForm fileId={file.id} sourceType={sourceType} sourceId={sourceId} />
        </div>
      </Card>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader title="Signatures" description="Recorded against this document." />
        </div>
        {signatures.length === 0 ? (
          <div className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
            No signatures recorded yet.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {signatures.map((signature) => (
              <li
                key={signature.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
              >
                <span className="text-sm font-medium">{signature.signerName}</span>
                {signature.signerRole ? (
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {signature.signerRole}
                  </span>
                ) : null}
                <span className="text-2xs text-[var(--text-tertiary)] uppercase">
                  {signature.method}
                </span>
                <When
                  value={signature.signedAt}
                  className="ml-auto text-xs text-[var(--text-tertiary)]"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {documentGroupId ? (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader title="Version history" />
          </div>
          {versions.length === 0 ? (
            <div className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
              No versions recorded.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {versions.map((version) => (
                <li
                  key={version.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
                >
                  <span className="text-sm font-medium">Version {version.versionNo}</span>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {version.changeNote ?? ''}
                  </span>
                  <When
                    value={version.createdAt}
                    className="ml-auto text-xs text-[var(--text-tertiary)]"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  )
}
