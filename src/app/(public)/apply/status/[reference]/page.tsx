import type { Metadata } from 'next'
import {
   lookupApplicationStatus,
  publicApplicationMessages,
  publicApplicationDocuments,
  publicApplicationDetails,
  publicFormOptions,
  publicKycRequirements,
} from '@modules/onboarding'
import { queryOr } from '@server/readiness'
import { PublicShell } from '@ui/layout/PublicShell'
import { ButtonLink } from '@ui/primitives/Button'
import { When } from '@ui/patterns/DateTime'
import { statusLabel } from '@ui/patterns/StatusChip'
import { ReplyPanel } from './ReplyPanel'

export const metadata: Metadata = {
  title: 'Application status',
  // The page is reachable by anyone holding the reference, so keep it out of search results.
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'


const STEPS = [
  { key: 'SUBMITTED', label: 'Received', description: 'We have your application.' },
  {
    key: 'UNDER_REVIEW',
    label: 'Under review',
    description: 'Someone is checking your details.',
  },
  { key: 'APPROVED', label: 'Decision', description: 'The outcome of your application.' },
] as const

/** Which step the applicant has reached. INFO_REQUESTED sits at review, not beyond it. */
function reachedStep(status: string): number {
  if (status === 'APPROVED' || status === 'REJECTED') return 2
  if (status === 'UNDER_REVIEW' || status === 'INFO_REQUESTED') return 1
  return 0
}

export default async function ApplicationStatusPage(
  props: PageProps<'/apply/status/[reference]'>,
) {
  const { reference } = await props.params
  const decoded = decodeURIComponent(reference).trim().toUpperCase()

  const application = await queryOr(undefined, () => lookupApplicationStatus(decoded))

  const awaitingReply = application?.status === 'INFO_REQUESTED'
  const isPreDecision =
    application?.status === 'SUBMITTED' ||
    application?.status === 'UNDER_REVIEW' ||
    application?.status === 'INFO_REQUESTED'
  // Fetch the thread for any pre-decision application so editing/reply options are available.
  const hasThread = isPreDecision

const [
  messages,
  documents,
  details,
  formOptions,
  kycRequirements,
] = hasThread
  ? await Promise.all([
      queryOr([], () => publicApplicationMessages(decoded)),
      queryOr([], () => publicApplicationDocuments(decoded)),
      queryOr(undefined, () => publicApplicationDetails(decoded)),
      queryOr(
        {
          branches: [],
          businessTypes: [],
          regions: [],
          coffeeTypes: [],
        },
        () => publicFormOptions(),
      ),
      queryOr([], () => publicKycRequirements()),
    ])
  : [
      [],
      [],
      undefined,
      {
        branches: [],
        businessTypes: [],
        regions: [],
        coffeeTypes: [],
      },
      [],
    ]

  return (
    <PublicShell>
      <main className="container-app max-w-2xl py-12">
        {!application ? (
          <div className="rounded-xl bg-[var(--surface-raised)] p-6 shadow-sm ring-1 ring-[var(--border-subtle)] sm:p-8">
            <h1 className="text-xl font-semibold">We could not find that reference</h1>
            <p className="mt-2 leading-relaxed text-[var(--text-secondary)]">
              Check the reference and try again. It starts with{' '}
              <span className="numeric">APP-</span> and is case-insensitive.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-[var(--text-secondary)]">
              If you have lost it, contact the branch you applied to — they can find your
              application from your business name and phone number.
            </p>
            <ButtonLink href="/apply/status" variant="primary" className="mt-6">
              Try another reference
            </ButtonLink>
          </div>
        ) : (
          <>
            <p className="numeric text-sm text-[var(--text-secondary)]">
              {application.reference}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {application.legalName}
            </h1>

            {/* ── Progress ────────────────────────────────────────────────── */}
            <ol className="mt-8 space-y-0">
              {STEPS.map((step, index) => {
                const reached = reachedStep(application.status)
                const done = index < reached
                const current = index === reached
                const rejected = application.status === 'REJECTED' && index === 2

                return (
                  <li key={step.key} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                          rejected
                            ? 'bg-danger-700 text-white'
                            : done || current
                              ? 'bg-brand-700 text-white'
                              : 'bg-[var(--surface-raised)] text-[var(--text-tertiary)] ring-1 ring-[var(--border-default)]'
                        }`}
                        aria-hidden
                      >
                        {done ? '✓' : index + 1}
                      </span>
                      {index < STEPS.length - 1 ? (
                        <span
                          className={`w-px flex-1 ${done ? 'bg-brand-700' : 'bg-[var(--border-subtle)]'}`}
                          aria-hidden
                        />
                      ) : null}
                    </div>

                    <div className="pb-8">
                      <p
                        className={`font-medium ${current || done ? '' : 'text-[var(--text-tertiary)]'}`}
                      >
                        {index === 2 ? statusLabel(application.status) : step.label}
                      </p>
                      <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                        {step.description}
                      </p>
                      {index === 0 && application.submittedAt ? (
                        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                          <When value={application.submittedAt} />
                        </p>
                      ) : null}
                      {index === 2 && application.decidedAt ? (
                        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                          <When value={application.decidedAt} />
                        </p>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ol>

            {/* ── What we need from them / reply thread ────────────────────── */}
            {isPreDecision && details ? (
              <div className="space-y-6">
                {awaitingReply ? (
                  <div className="rounded-xl bg-warning-50 p-5 ring-1 ring-warning-100 sm:p-6 dark:bg-warning-900/20 dark:ring-warning-900">
                    <h2 className="font-semibold text-warning-900 dark:text-warning-100">
                      We need something from you
                    </h2>
                    {application.infoRequested ? (
                      <p className="mt-2 whitespace-pre-line text-sm text-warning-900 dark:text-warning-100">
                        {application.infoRequested}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <ReplyPanel
                  reference={application.reference}
                  messages={messages}
                  documents={documents}
                  details={details}
                  branches={formOptions.branches}
                  businessTypes={formOptions.businessTypes}
                  regions={formOptions.regions}
                  coffeeTypes={formOptions.coffeeTypes}
                  kycRequirements={kycRequirements}
                  awaitingReply={awaitingReply}
                />
              </div>
            ) : isPreDecision ? (
              <div className="rounded-xl bg-warning-50 p-5 ring-1 ring-warning-100 sm:p-6 dark:bg-warning-900/20 dark:ring-warning-900">
                <h2 className="font-semibold text-warning-900 dark:text-warning-100">
                  We need something from you
                </h2>
                {application.infoRequested ? (
                  <p className="mt-2 whitespace-pre-line text-sm text-warning-900 dark:text-warning-100">
                    {application.infoRequested}
                  </p>
                ) : null}
                <p className="mt-3 text-sm text-warning-900/80 dark:text-warning-100/80">
                  Send it to the branch you applied to, quoting your reference.
                </p>
              </div>
            ) : null}

            {application.status === 'APPROVED' ? (
              <div className="rounded-xl bg-success-50 p-5 ring-1 ring-success-100 sm:p-6 dark:bg-success-900/20 dark:ring-success-900">
                <h2 className="font-semibold text-success-700 dark:text-success-100">
                  Your application was approved
                </h2>
                <p className="mt-2 text-sm text-success-700 dark:text-success-100">
                  We have emailed an activation link so you can set a password and sign in.
                  EthioStar never sends passwords by email.
                </p>
                <ButtonLink href="/login" variant="primary" className="mt-4">
                  Go to sign in
                </ButtonLink>
              </div>
            ) : null}

            {application.status === 'REJECTED' ? (
              <div className="rounded-xl bg-[var(--surface-raised)] p-5 shadow-sm ring-1 ring-[var(--border-subtle)] sm:p-6">
                <h2 className="font-semibold">This application was not approved</h2>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                  Contact the branch you applied to if you would like to discuss the decision or
                  apply again.
                </p>
              </div>
            ) : null}
          </>
        )}
      </main>
    </PublicShell>
  )
}
