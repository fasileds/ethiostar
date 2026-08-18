import type { Metadata } from 'next'
import Link from 'next/link'
import { pageContext } from '@server/page-data'
import { canPerform } from '@server/auth/authorize'
import { REPORT_CATEGORIES, reportsByCategory } from '@modules/reporting'
import { PageHeader, Card, CardHeader, EmptyState } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Reports' }

/**
 * M21 — the standard report library, grouped by the five categories the client document
 * defines (§7.2). A fixed catalogue on purpose: every report here is a reviewed query, not
 * an ad-hoc filter a user assembled — that scope is explicitly out for this module.
 *
 * A category with nothing the actor may open (Store Keeper and "Commercial & financial", for
 * instance) is left off the page entirely, the same courtesy the main nav gives every link.
 */
export default async function ReportsPage() {
  const { readiness, actor } = await pageContext()

  const sections = REPORT_CATEGORIES.map((category) => ({
    ...category,
    reports: reportsByCategory(category.key).filter((report) =>
      canPerform(actor, report.permission),
    ),
  })).filter((section) => section.reports.length > 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="The standard report library — operations, store, yield, commercial and governance. Every report exports to CSV."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      {sections.length === 0 ? (
        <EmptyState
          title="No reports available"
          description="Your role does not hold a report permission yet. Ask an administrator to grant report:view_operational or report:view_financial."
          icon={<Icon name="audit" className="size-8" />}
        />
      ) : (
        sections.map((section) => (
          <Card key={section.key} padded={false}>
            <div className="p-4 sm:p-5">
              <CardHeader title={section.label} />
            </div>
            <ul className="divide-y divide-[var(--border-subtle)]">
              {section.reports.map((report) => (
                <li key={report.key}>
                  <Link
                    href={`/reports/${section.key}/${report.key}`}
                    className="interactive-surface block px-4 py-3 hover:bg-[var(--surface-hover)] sm:px-5"
                  >
                    <p className="text-sm font-medium">{report.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                      {report.description}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  )
}
