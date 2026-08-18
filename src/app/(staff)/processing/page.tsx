import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import { listJobOrders, jobOrderStatusCounts, type JobOrderRow } from '@modules/processing'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, SearchForm, ListToolbar } from '@ui/patterns/FilterBar'
import { StatusChip, statusLabel } from '@ui/patterns/StatusChip'
import { Percentage } from '@ui/patterns/Quantity'
import { When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Processing' }

const COLUMNS: ReadonlyArray<Column<JobOrderRow>> = [
  { key: 'reference', header: 'Job', render: (row) => row.reference },
  {
    key: 'customer',
    header: 'Customer',
    render: (row) => (
      <div className="min-w-0">
        <div className="truncate">{row.customerName}</div>
        <div className="numeric truncate text-xs text-[var(--text-tertiary)]">
          {row.consignmentReference}
        </div>
      </div>
    ),
  },
  {
    key: 'service',
    header: 'Service',
    render: (row) => (
      <div className="min-w-0">
        <div>{statusLabel(row.serviceType)}</div>
        <div className="truncate text-xs text-[var(--text-tertiary)]">
          {row.machineName ?? 'No machine'}
        </div>
      </div>
    ),
  },
  {
    key: 'input',
    header: 'Input',
    numeric: true,
    // Kilograms only. A job consumes weight, not bags — the kesha are emptied and tracked
    // separately by M13, and showing a bag count here would imply they went through the line.
    render: (row) => (
      <span className="numeric">
        {row.actualInputKg ?? row.plannedInputKg}
        <span className="ml-0.5 font-normal opacity-55">kg</span>
      </span>
    ),
  },
  {
    key: 'yield',
    header: 'Yield',
    numeric: true,
    render: (row) =>
      row.yieldPct ? (
        <Percentage value={row.yieldPct} size="sm" />
      ) : (
        <span className="text-xs text-[var(--text-tertiary)]">—</span>
      ),
  },
  {
    key: 'balance',
    header: 'Mass balance',
    render: (row) =>
      row.massBalanceStatus ? (
        <StatusChip status={row.massBalanceStatus} />
      ) : (
        <span className="text-xs text-[var(--text-tertiary)]">Not closed</span>
      ),
  },
  {
    key: 'started',
    header: 'Started',
    secondary: true,
    render: (row) => <When value={row.startedAt} />,
  },
  { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
]

/**
 * M15 — job orders.
 *
 * The mass-balance column is the one that matters. EXCEPTION means the kilograms in did not
 * equal the kilograms out plus recorded loss, within the tolerance that applied at the time —
 * and a job cannot be CLOSED without a verdict, so a blank here means the work is still open,
 * never that the check was skipped.
 */
export default async function ProcessingPage(props: PageProps<'/processing'>) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness } = await pageContext()
  const status = firstParam(search, 'status')

  const [page, counts] = await Promise.all([
    pageQuery(emptyListPage<JobOrderRow>(), (tx) =>
      listJobOrders(tx, { status, search: params.q, cursor: params.cursor }),
    ),
    pageQuery({} as Readonly<Record<string, number>>, jobOrderStatusCounts),
  ])

  const tabs = [
    { value: '', label: 'All' },
    { value: 'PLANNED', label: 'Planned', count: counts.PLANNED },
    { value: 'IN_PROGRESS', label: 'Running', count: counts.IN_PROGRESS },
    { value: 'PAUSED', label: 'Paused', count: counts.PAUSED },
    { value: 'COMPLETED', label: 'Completed', count: counts.COMPLETED },
    { value: 'CLOSED', label: 'Closed', count: counts.CLOSED },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Processing"
        description="Sorting, hulling and grading runs. Every closed job balances its inputs against its outputs and recorded loss."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <ListToolbar
          trailing={
            <SearchForm
              action="/processing"
              defaultValue={params.q}
              hidden={params}
              placeholder="Job, consignment or customer…"
            />
          }
        >
          <FilterTabs
            options={tabs}
            active={status ?? ''}
            basePath="/processing"
            params={params}
          />
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          rowHref={(row) => `/processing/${row.id}`}
          caption="Job orders"
          empty={{
            title: 'No job orders',
            description:
              'A job order is raised from an approved processing request, against a scheduled appointment.',
            icon: <Icon name="processing" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/processing"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
