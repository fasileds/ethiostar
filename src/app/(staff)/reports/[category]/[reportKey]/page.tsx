import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pageContext, pageQuery, firstParam } from '@server/page-data'
import { canPerform } from '@server/auth/authorize'
import { findReport, type ReportRunParams } from '@modules/reporting'
import { PageHeader, Card, CardHeader, EmptyState } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { buttonClass } from '@ui/primitives/Button'
import { Icon } from '@ui/layout/Icon'
import { systemClock } from '@core/clock/clock'
import { toBusinessDate, addDays } from '@core/utils/date'

export const metadata: Metadata = { title: 'Report' }

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (value instanceof Date) return value.toLocaleString('en-GB')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/**
 * The generic report viewer.
 *
 * One page renders every report in the catalogue: a small date/period filter bar (a plain GET
 * form — no client JS needed to re-run a report), the result as a table, and a CSV download
 * that carries the same filters through to `/api/v1/reports/.../csv`.
 */
export default async function ReportViewerPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ category: string; reportKey: string }>
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { category, reportKey } = await params
  const search = await searchParams
  const { readiness, actor } = await pageContext()

  const report = findReport(category, reportKey)
  if (!report) notFound()
  if (!canPerform(actor, report.permission)) notFound()

  const today = toBusinessDate(systemClock.now())
  const monthAgo = toBusinessDate(addDays(systemClock.now(), -30))

  const runParams: ReportRunParams = {
    branchId: firstParam(search, 'branchId') ?? null,
    date: firstParam(search, 'date') ?? today,
    periodStart: firstParam(search, 'periodStart') ?? monthAgo,
    periodEnd: firstParam(search, 'periodEnd') ?? today,
    asOfDate: firstParam(search, 'asOfDate') ?? today,
  }

  const rows = readiness.ready
    ? await pageQuery([] as readonly Record<string, unknown>[], (tx) =>
        report.run(tx, runParams),
      )
    : []

  const csvHref = `/api/v1/reports/${category}/${reportKey}/csv?${new URLSearchParams({
    date: runParams.date,
    periodStart: runParams.periodStart,
    periodEnd: runParams.periodEnd,
    asOfDate: runParams.asOfDate,
    ...(runParams.branchId ? { branchId: runParams.branchId } : {}),
  }).toString()}`

  return (
    <div className="space-y-6">
      <PageHeader
        title={report.title}
        description={report.description}
        actions={
          <a href={csvHref} className={buttonClass({ variant: 'secondary' })}>
            <Icon name="documents" />
            Download CSV
          </a>
        }
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            Date
            <input
              type="date"
              name="date"
              defaultValue={runParams.date}
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            Period start
            <input
              type="date"
              name="periodStart"
              defaultValue={runParams.periodStart}
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            Period end
            <input
              type="date"
              name="periodEnd"
              defaultValue={runParams.periodEnd}
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            As of date
            <input
              type="date"
              name="asOfDate"
              defaultValue={runParams.asOfDate}
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-sm"
            />
          </label>
          <button type="submit" className={buttonClass({ variant: 'primary', size: 'md' })}>
            Run report
          </button>
        </form>
      </Card>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Results"
            description={`${rows.length} row${rows.length === 1 ? '' : 's'}`}
          />
        </div>

        {rows.length === 0 ? (
          <div className="px-4 pb-5 sm:px-5">
            <EmptyState
              title="No rows for this filter"
              description="Adjust the date range above and run the report again."
              icon={<Icon name="documents" className="size-8" />}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-left text-xs text-[var(--text-secondary)]">
                  {report.columns.map((column) => (
                    <th key={String(column.key)} className="px-4 py-2.5 font-medium sm:px-5">
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {rows.map((row, index) => (
                  <tr key={index}>
                    {report.columns.map((column) => (
                      <td key={String(column.key)} className="numeric px-4 py-2.5 sm:px-5">
                        {formatCell(row[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
