import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pageContext, pageQuery } from '@server/page-data'
import {
  findApplication,
  applicationDocuments,
  applicationHistory,
  applicationMessages,
  type ApplicationDocumentRow,
  type ApplicationMessageRow,
} from '@modules/onboarding'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { StatusChip } from '@ui/patterns/StatusChip'
import { When } from '@ui/patterns/DateTime'
import {
  StartReviewButton,
  AttachDocumentForm,
  VerifyDocumentButtons,
  RequestInfoForm,
  RejectForm,
  ApproveButton,
  ChatThread,
} from './ReviewActions'
import { DocumentPreviewLink } from './DocumentPreviewLink'

export const metadata: Metadata = { title: 'Application' }

function Field({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
  if (!value) return null
  return (
    <div>
      <div className="text-xs text-[var(--text-tertiary)]">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  )
}

function documentRowState(
  row: ApplicationDocumentRow,
): 'missing' | 'pending' | 'verified' | 'rejected' {
  if (!row.id || !row.fileId) return 'missing'
  if (row.verificationStatus === 'VERIFIED') return 'verified'
  if (row.verificationStatus === 'REJECTED') return 'rejected'
  return 'pending'
}

export default async function ApplicationDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { readiness } = await pageContext()

  if (!readiness.ready) {
    return (
      <div className="space-y-6">
        <PageHeader title="Application" />
        <Card>Database is not ready.</Card>
      </div>
    )
  }

  const [detail, documents, history, messages] = await Promise.all([
    pageQuery(undefined, (tx) => findApplication(tx, id)),
    pageQuery([] as ApplicationDocumentRow[], (tx) => applicationDocuments(tx, id)),
    pageQuery([], (tx) => applicationHistory(tx, id)),
    pageQuery([] as ApplicationMessageRow[], (tx) => applicationMessages(tx, id)),
  ])

  if (!detail) notFound()

  const mandatoryOutstanding = documents.filter(
    (d) => d.isMandatory && documentRowState(d) !== 'verified',
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail.legalName}
        description={`Application ${detail.reference}`}
        meta={<StatusChip status={detail.status} />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Applicant" />
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Trade name" value={detail.tradeName} />
              <Field label="Business type" value={detail.businessTypeName} />
              <Field label="TIN" value={detail.tin} />
              <Field label="Business licence" value={detail.businessLicenceNo} />
              <Field label="Branch" value={detail.branchName} />
              <Field label="Region" value={detail.regionName} />
              <Field label="Contact" value={detail.contactName} />
              <Field label="Position" value={detail.contactPosition} />
              <Field label="Phone" value={detail.contactPhone} />
              <Field label="Email" value={detail.contactEmail} />
              <Field
                label="Submitted"
                value={detail.submittedAt ? <When value={detail.submittedAt} dateOnly /> : null}
              />
            </div>
            {detail.intendedServices ? (
              <p className="mt-4 text-sm text-[var(--text-secondary)]">
                {detail.intendedServices}
              </p>
            ) : null}
          </Card>

          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardHeader
                title="KYC checklist"
                description="An application cannot be approved while a mandatory document is missing, unverified or expired."
              />
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {documents.map((doc) => {
                const state = documentRowState(doc)
                return (
                  <div key={doc.documentTypeId} className="space-y-3 p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium">{doc.documentTypeName}</span>
                        {doc.isMandatory ? (
                          <span className="ml-2 text-xs text-[var(--text-tertiary)]">
                            mandatory
                          </span>
                        ) : null}
                      </div>
                      <StatusChip
                        status={
                          state === 'missing'
                            ? 'MISSING'
                            : state === 'pending'
                              ? 'PENDING'
                              : state
                        }
                      />
                    </div>

                    {doc.originalFilename ? (
                      <div className="text-sm text-[var(--text-secondary)]">
                        {doc.fileId ? (
                          <DocumentPreviewLink
                            fileId={doc.fileId}
                            filename={doc.originalFilename}
                          />
                        ) : (
                          doc.originalFilename
                        )}
                        {doc.expiresOn ? ` · expires ${doc.expiresOn}` : ''}
                      </div>
                    ) : null}

                    {doc.rejectionReason ? (
                      <p className="text-sm text-danger-700 dark:text-danger-300">
                        {doc.rejectionReason}
                      </p>
                    ) : null}

                    {state === 'pending' && doc.id ? (
                      <VerifyDocumentButtons
                        applicationId={id}
                        documentId={doc.id}
                        hasExpiry={doc.hasExpiry}
                      />
                    ) : null}

                    {state === 'missing' || state === 'rejected' ? (
                      <AttachDocumentForm
                        applicationId={id}
                        documentTypeId={doc.documentTypeId}
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="History" />
            <ol className="mt-4 space-y-2 text-sm">
              {history.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3">
                  <span>
                    {entry.fromStatus ? `${entry.fromStatus} → ` : ''}
                    {entry.toStatus}
                    {entry.note ? (
                      <span className="text-[var(--text-tertiary)]"> — {entry.note}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[var(--text-tertiary)]">
                    <When value={entry.changedAt} />
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHeader
              title="Messages"
              description="Visible to the applicant on their status page."
            />
            <div className="mt-4">
              <ChatThread applicationId={id} messages={messages} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Decision" />
            <div className="mt-4 space-y-4">
              {detail.status === 'SUBMITTED' ? <StartReviewButton applicationId={id} /> : null}

              {detail.status === 'UNDER_REVIEW' || detail.status === 'INFO_REQUESTED' ? (
                <>
                  {mandatoryOutstanding.length > 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">
                      {mandatoryOutstanding.length} mandatory document
                      {mandatoryOutstanding.length === 1 ? '' : 's'} still need
                      {mandatoryOutstanding.length === 1 ? 's' : ''} attention before this can
                      be approved.
                    </p>
                  ) : (
                    <ApproveButton applicationId={id} />
                  )}
                  <RequestInfoForm applicationId={id} />
                  <RejectForm applicationId={id} />
                </>
              ) : null}

              {detail.status === 'APPROVED' ? (
                <p className="text-sm text-[var(--text-secondary)]">
                  Approved
                  {detail.decidedAt ? (
                    <>
                      {' '}
                      on <When value={detail.decidedAt} dateOnly />
                    </>
                  ) : null}
                  .
                  {detail.customerId ? ' The customer record and login have been created.' : ''}
                </p>
              ) : null}

              {detail.status === 'REJECTED' ? (
                <p className="text-sm text-[var(--text-secondary)]">
                  Rejected: {detail.rejectionReason}
                </p>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
