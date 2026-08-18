import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { recentPrints, type PrintLogRow } from '@modules/printing'
import { PageHeader, Card, CardHeader, EmptyState, StatCard } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'
import { buttonClass } from '@ui/primitives/Button'

export const metadata: Metadata = { title: 'Printing' }

/**
 * M06 — the print log.
 *
 * Ethiopian coffee operations run on paper and the paper is the legal artefact, so every
 * print is recorded with a per-document copy number. A reprint is therefore visible AS a
 * reprint — "who printed the third copy of this goods receipt, and why" is a question that
 * comes up in disputes, and a system that cannot answer it is no better than the stack of
 * paper it replaced.
 *
 * The log is append-only, enforced by trigger.
 */
export default async function PrintingPage() {
  const { readiness } = await pageContext()

  const prints = await pageQuery([] as PrintLogRow[], (tx) => recentPrints(tx, 50))

  const reprints = prints.filter((print) => print.copyNo > 1)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Printing"
        description="Every printed document, with its copy number. Each carries a QR code resolving to a verification page."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard
          label="Documents printed"
          value={<span className="numeric text-3xl font-semibold">{prints.length}</span>}
          hint="Most recent 50 shown"
          icon={<Icon name="printing" />}
        />
        <StatCard
          label="Reprints"
          intent={reprints.length > 0 ? 'warn' : 'neutral'}
          value={<span className="numeric text-3xl font-semibold">{reprints.length}</span>}
          hint="Copy 2 or later"
          icon={<Icon name="documents" />}
        />
        <StatCard
          label="Verification"
          value={<span className="text-lg font-semibold">QR on every page</span>}
          hint="A photocopy with an altered weight fails the check"
          icon={<Icon name="audit" />}
        />
      </div>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Print log"
            description="Append-only. A reprint always records why it was needed."
          />
        </div>

        {prints.length === 0 ? (
          <div className="px-4 pb-5 sm:px-5">
            <EmptyState
              title="Nothing printed yet"
              description="Documents are printed from the record they belong to — a goods receipt, an acceptance, a dispatch order — and every print lands here."
              icon={<Icon name="printing" className="size-8" />}
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {prints.map((print) => (
              <li
                key={print.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
              >
                <span className="shrink-0 text-sm font-medium">{print.documentType}</span>
                {print.documentReference ? (
                  <span className="numeric shrink-0 text-sm text-[var(--text-secondary)]">
                    {print.documentReference}
                  </span>
                ) : null}

                {print.copyNo > 1 ? (
                  <span
                    className="shrink-0 rounded bg-warning-50 px-1.5 py-0.5 text-2xs font-semibold text-warning-900 dark:bg-warning-900/25 dark:text-warning-100"
                    title={print.reprintReason ?? undefined}
                  >
                    Copy {print.copyNo}
                  </span>
                ) : null}

                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-tertiary)]">
                  {print.reprintReason ?? ''}
                </span>

                <span className="shrink-0 text-xs text-[var(--text-secondary)]">
                  {print.printedByName ?? '—'}
                </span>
                <span className="shrink-0 text-2xs text-[var(--text-tertiary)] uppercase">
                  {print.locale}
                </span>
                <When
                  value={print.printedAt}
                  className="shrink-0 text-xs text-[var(--text-tertiary)]"
                />
                <a
                  href={`/api/v1/documents/${print.id}/pdf`}
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
