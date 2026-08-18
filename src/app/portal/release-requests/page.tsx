import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import { listReleaseRequests, type ReleaseRequestRow } from '@modules/dispatch'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, ListToolbar } from '@ui/patterns/FilterBar'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Quantity } from '@ui/patterns/Quantity'
import { OnDate } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Release requests' }

const COLUMNS: ReadonlyArray<Column<ReleaseRequestRow>> = [
  { key: 'reference', header: 'Reference', render: (row) => row.reference },
  {
    key: 'quantity',
    header: 'Requested',
    numeric: true,
    render: (row) => (
      <Quantity
        quantityKg={row.requestedQuantityKg}
        keshaCount={row.requestedKeshaCount ?? 0}
        size="sm"
        layout="stacked"
        className="items-end"
      />
    ),
  },
  {
    key: 'collection',
    header: 'Collection',
    render: (row) => <OnDate value={row.requestedCollectionOn} />,
  },
  {
    key: 'authorised',
    header: 'Authorised by',
    render: (row) => row.authorisedByName ?? '—',
  },
  {
    key: 'collector',
    header: 'Collector',
    secondary: true,
    render: (row) => row.collectorName ?? '—',
  },
  { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
]

/**
 * Release requests.
 *
 * A release must be authorised by a named contact who holds that permission on the customer
 * record. That link is what stops a driver collecting someone else's coffee with a plausible
 * phone call, so the authorising contact is shown as a column rather than buried in detail.
 */
export default async function PortalReleaseRequestsPage(
  props: PageProps<'/portal/release-requests'>,
) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness, customerId } = await pageContext()
  const status = firstParam(search, 'status')

  const page = await pageQuery(emptyListPage<ReleaseRequestRow>(), (tx) =>
    listReleaseRequests(tx, {
      customerId: customerId ?? undefined,
      status,
      cursor: params.cursor,
    }),
  )

  const tabs = [
    { value: '', label: 'All' },
    { value: 'SUBMITTED', label: 'Awaiting approval' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'DISPATCHED', label: 'Collected' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Release requests"
        description="Ask to collect your coffee. Only a contact you have authorised may raise one."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <ListToolbar>
          <FilterTabs
            options={tabs}
            active={status ?? ''}
            basePath="/portal/release-requests"
            params={params}
          />
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          caption="My release requests"
          empty={{
            title: 'No release requests',
            description:
              'Raise a request to collect coffee. It must be authorised by a contact on your account who holds release permission.',
            icon: <Icon name="dispatch" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/portal/release-requests"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
