import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import {
  listApplications,
  applicationStatusCounts,
  type ApplicationListRow,
} from '@modules/onboarding'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, SearchForm, ListToolbar } from '@ui/patterns/FilterBar'
import { StatusChip } from '@ui/patterns/StatusChip'
import { When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Applications' }

const COLUMNS: ReadonlyArray<Column<ApplicationListRow>> = [
  { key: 'reference', header: 'Reference', render: (row) => row.reference },
  {
    key: 'applicant',
    header: 'Applicant',
    render: (row) => (
      <div className="min-w-0">
        <div className="truncate">{row.legalName}</div>
        {row.tradeName ? (
          <div className="truncate text-xs text-[var(--text-tertiary)]">
            trading as {row.tradeName}
          </div>
        ) : null}
      </div>
    ),
  },
  {
    key: 'contact',
    header: 'Contact',
    secondary: true,
    render: (row) => (
      <div className="min-w-0">
        <div className="truncate">{row.contactName}</div>
        <div className="numeric truncate text-xs text-[var(--text-tertiary)]">
          {row.contactPhone}
        </div>
      </div>
    ),
  },
  {
    key: 'documents',
    header: 'KYC',
    numeric: true,
    render: (row) => (
      <span
        className={
          row.documentsVerified < row.documentsTotal
            ? 'text-warning-900 dark:text-warning-100'
            : undefined
        }
        title={`${row.documentsVerified} of ${row.documentsTotal} documents verified`}
      >
        {row.documentsVerified} / {row.documentsTotal}
      </span>
    ),
  },
  {
    key: 'submitted',
    header: 'Submitted',
    secondary: true,
    render: (row) => <When value={row.submittedAt} dateOnly />,
  },
  { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
]

/**
 * M08 — the application review queue.
 *
 * Opens on SUBMITTED, not on everything. The queue exists to be emptied, and a list showing
 * every application ever received buries the four that need a decision today.
 */
export default async function ApplicationsPage(props: PageProps<'/applications'>) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness } = await pageContext()

  const status = firstParam(search, 'status') ?? 'SUBMITTED'

  const [page, counts] = await Promise.all([
    pageQuery(emptyListPage<ApplicationListRow>(), (tx) =>
      listApplications(tx, {
        status: status === 'ALL' ? undefined : status,
        search: params.q,
        cursor: params.cursor,
      }),
    ),
    pageQuery({} as Readonly<Record<string, number>>, applicationStatusCounts),
  ])

  const tabs = [
    { value: 'SUBMITTED', label: 'Submitted', count: counts.SUBMITTED },
    { value: 'UNDER_REVIEW', label: 'Under review', count: counts.UNDER_REVIEW },
    { value: 'INFO_REQUESTED', label: 'Info requested', count: counts.INFO_REQUESTED },
    { value: 'APPROVED', label: 'Approved', count: counts.APPROVED },
    { value: 'REJECTED', label: 'Rejected', count: counts.REJECTED },
    { value: 'ALL', label: 'All' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer applications"
        description="New customers apply here. Verify the KYC documents, then approve to create the customer record."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <ListToolbar
          trailing={
            <SearchForm action="/applications" defaultValue={params.q} hidden={params} />
          }
        >
          <FilterTabs options={tabs} active={status} basePath="/applications" params={params} />
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          rowHref={(row) => `/applications/${row.id}`}
          caption="Customer applications"
          empty={{
            title:
              status === 'SUBMITTED' ? 'Nothing waiting for review' : 'No applications here',
            description:
              status === 'SUBMITTED'
                ? 'Every submitted application has been picked up. New ones arrive from the public application form.'
                : 'Try a different status, or clear the search.',
            icon: <Icon name="applications" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/applications"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
