import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { listDocumentTemplates, type DocumentTemplateAdminRow } from '@modules/printing'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DocumentTemplatesClient } from './DocumentTemplatesClient'

export const metadata: Metadata = { title: 'Document templates' }

/**
 * M06 — layout metadata behind every printed document. This is CRUD over the
 * `document_template` table (code, version, locale, page size), not the react-pdf renderers
 * themselves — those live under `src/platform/pdf` and `src/server/documents`.
 */
export default async function DocumentTemplatesPage() {
  const { readiness } = await pageContext()

  const templates = await pageQuery([] as DocumentTemplateAdminRow[], (tx) =>
    listDocumentTemplates(tx),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document templates"
        description="Layouts for goods receipts, gate passes, acceptances, delivery notes, coffee passports and labels."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Templates by document type"
            description="Publishing a new version never overwrites one already in use — it adds a new template_version row."
          />
        </div>
        <div className="px-4 pb-5 sm:px-5">
          <DocumentTemplatesClient templates={templates} />
        </div>
      </Card>
    </div>
  )
}
