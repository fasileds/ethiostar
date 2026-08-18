import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import {
  listDeliveryRequests,
  deliveryRequestStatusCounts,
  type DeliveryRequestRow,
} from '@modules/inbound'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, SearchForm, ListToolbar } from '@ui/patterns/FilterBar'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Quantity } from '@ui/patterns/Quantity'
import { OnDate } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Delivery requests' }

const COLUMNS: ReadonlyArray<Column<DeliveryRequestRow>> = [
  { key: 'reference', header: 'Reference', render: (row) => row.reference },
  {
    key: 'customer',
    header: 'Customer',
    render: (row) => <span className="block truncate">{row.customerName}</span>,
  },
  {
    key: 'coffee',
    header: 'Coffee',
    secondary: true,
    render: (row) => row.coffeeTypeName ?? '—',
  },
  {
    key: 'declared',
    header: 'Declared',
    numeric: true,
    render: (row) => (
      <Quantity
        quantityKg={row.declaredQuantityKg}
        keshaCount={row.declaredKeshaCount}
        size="sm"
        layout="stacked"
        className="items-end"
      />
    ),
  },
  {
    key: 'expected',
    header: 'Expected',
    render: (row) => <OnDate value={row.expectedArrivalOn} />,
  },
  {
    key: 'vehicle',
    header: 'Vehicle',
    secondary: true,
    render: (row) =>
      row.vehiclePlate ? (
        <span className="numeric">{row.vehiclePlate}</span>
      ) : (
        <span className="text-[var(--text-tertiary)]">—</span>
      ),
  },
  { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
]

/**
 * M11 — the delivery-request approval queue.
 *
 * Approving a request reserves warehouse space and creates the consignment, so this screen
 * opens on SUBMITTED: the requests that have not yet had that decision made. Everything
 * downstream — the gate pass, the receiving bay's work list, the capacity figures — depends
 * on it happening promptly.
 */
export default async function DeliveryRequestsPage(props: PageProps<'/delivery-requests'>) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness } = await pageContext()
  const status = firstParam(search, 'status') ?? 'SUBMITTED'

  const [page, counts] = await Promise.all([
    pageQuery(emptyListPage<DeliveryRequestRow>(), (tx) =>
      listDeliveryRequests(tx, {
        status: status === 'ALL' ? undefined : status,
        search: params.q,
        cursor: params.cursor,
      }),
    ),
    pageQuery({} as Readonly<Record<string, number>>, deliveryRequestStatusCounts),
  ])

  const tabs = [
    { value: 'SUBMITTED', label: 'To approve', count: counts.SUBMITTED },
    { value: 'APPROVED', label: 'Approved', count: counts.APPROVED },
    { value: 'ARRIVED', label: 'Arrived', count: counts.ARRIVED },
    { value: 'RECEIVED', label: 'Received', count: counts.RECEIVED },
    { value: 'REJECTED', label: 'Rejected', count: counts.REJECTED },
    { value: 'ALL', label: 'All' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Delivery requests"
        description="A customer asks to bring coffee in. Approving reserves store space and opens the consignment."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <ListToolbar
          trailing={
            <SearchForm
              action="/delivery-requests"
              defaultValue={params.q}
              hidden={params}
              placeholder="Reference, customer or plate…"
            />
          }
        >
          <FilterTabs
            options={tabs}
            active={status}
            basePath="/delivery-requests"
            params={params}
          />
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          rowHref={(row) => `/delivery-requests/${row.id}`}
          caption="Delivery requests"
          empty={{
            title: status === 'SUBMITTED' ? 'Nothing to approve' : 'No delivery requests here',
            description:
              status === 'SUBMITTED'
                ? 'Every submitted request has a decision. Customers raise new ones from the portal.'
                : 'Try a different status, or clear the search.',
            icon: <Icon name="delivery" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/delivery-requests"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
