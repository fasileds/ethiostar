import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import { listDeliveryRequests, type DeliveryRequestRow } from '@modules/inbound'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, ListToolbar } from '@ui/patterns/FilterBar'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Quantity } from '@ui/patterns/Quantity'
import { OnDate } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'
import { ButtonLink } from '@ui/primitives/Button'

export const metadata: Metadata = { title: 'Delivery requests' }

const COLUMNS: ReadonlyArray<Column<DeliveryRequestRow>> = [
  { key: 'reference', header: 'Reference', render: (row) => row.reference },
  { key: 'coffee', header: 'Coffee', render: (row) => row.coffeeTypeName ?? '—' },
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
    header: 'Expected arrival',
    render: (row) => <OnDate value={row.expectedArrivalOn} />,
  },
  {
    key: 'vehicle',
    header: 'Vehicle',
    secondary: true,
    render: (row) => <span className="numeric">{row.vehiclePlate ?? '—'}</span>,
  },
  { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
]

/**
 * The customer's delivery requests.
 *
 * A request is a proposal, not a booking. It becomes real when EthioStar approves it, which
 * is also the moment store space is reserved for it, so the status column is the honest
 * answer to "can I send the truck yet".
 */
export default async function PortalDeliveryRequestsPage(
  props: PageProps<'/portal/delivery-requests'>,
) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness, customerId } = await pageContext()
  const status = firstParam(search, 'status')

  const page = await pageQuery(emptyListPage<DeliveryRequestRow>(), (tx) =>
    listDeliveryRequests(tx, {
      customerId: customerId ?? undefined,
      status,
      cursor: params.cursor,
    }),
  )

  const tabs = [
    { value: '', label: 'All' },
    { value: 'SUBMITTED', label: 'Awaiting approval' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'RECEIVED', label: 'Received' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Delivery requests"
        description="Ask to bring coffee in. EthioStar reserves store space when the request is approved."
        actions={<ButtonLink href="/portal/delivery-requests/new">New request</ButtonLink>}
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <ListToolbar>
          <FilterTabs
            options={tabs}
            active={status ?? ''}
            basePath="/portal/delivery-requests"
            params={params}
          />
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          caption="My delivery requests"
          empty={{
            title: 'No delivery requests',
            description:
              'Raise a request when you want to bring coffee in. EthioStar will confirm the date and reserve space for it.',
            icon: <Icon name="delivery" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/portal/delivery-requests"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
