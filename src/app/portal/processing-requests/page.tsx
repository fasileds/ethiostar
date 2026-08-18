import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import { listProcessingRequests, type ProcessingRequestRow } from '@modules/processing'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, ListToolbar } from '@ui/patterns/FilterBar'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Quantity } from '@ui/patterns/Quantity'
import { OnDate } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Processing requests' }

const COLUMNS: ReadonlyArray<Column<ProcessingRequestRow>> = [
  { key: 'reference', header: 'Reference', render: (row) => row.reference },
  { key: 'service', header: 'Service', render: (row) => row.serviceType },
  {
    key: 'quantity',
    header: 'Quantity',
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
    key: 'preferred',
    header: 'Preferred start',
    render: (row) => <OnDate value={row.preferredStartOn} />,
  },
  { key: 'urgency', header: 'Urgency', secondary: true, render: (row) => row.urgency },
  { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
]

/** Requests to have stored coffee sorted, hulled or graded. */
export default async function PortalProcessingRequestsPage(
  props: PageProps<'/portal/processing-requests'>,
) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness, customerId } = await pageContext()
  const status = firstParam(search, 'status')

  const page = await pageQuery(emptyListPage<ProcessingRequestRow>(), (tx) =>
    listProcessingRequests(tx, {
      customerId: customerId ?? undefined,
      status,
      cursor: params.cursor,
    }),
  )

  const tabs = [
    { value: '', label: 'All' },
    { value: 'SUBMITTED', label: 'Awaiting approval' },
    { value: 'SCHEDULED', label: 'Scheduled' },
    { value: 'COMPLETED', label: 'Completed' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Processing requests"
        description="Ask for stored coffee to be sorted, hulled or graded. Approved requests are given an appointment."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <ListToolbar>
          <FilterTabs
            options={tabs}
            active={status ?? ''}
            basePath="/portal/processing-requests"
            params={params}
          />
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          caption="My processing requests"
          empty={{
            title: 'No processing requests',
            description:
              'Request processing for coffee already in storage. EthioStar schedules it against a machine and confirms the date.',
            icon: <Icon name="processing" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/portal/processing-requests"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
