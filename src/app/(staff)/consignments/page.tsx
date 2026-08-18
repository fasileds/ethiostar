import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import {
  listConsignments,
  consignmentStatusCounts,
  type ConsignmentRow,
} from '@modules/consignment'
import { ConsignmentStatusBadge } from '@modules/consignment/ui/StatusBadge'
import type { ConsignmentStatus } from '@modules/consignment'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, SearchForm, ListToolbar } from '@ui/patterns/FilterBar'
import { Quantity } from '@ui/patterns/Quantity'
import { When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Consignments' }

const COLUMNS: ReadonlyArray<Column<ConsignmentRow>> = [
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
    key: 'received',
    header: 'Received',
    numeric: true,
    render: (row) =>
      row.receivedQuantityKg ? (
        <Quantity
          quantityKg={row.receivedQuantityKg}
          keshaCount={row.receivedKeshaCount ?? 0}
          size="sm"
          layout="stacked"
          className="items-end"
        />
      ) : (
        <span className="text-xs text-[var(--text-tertiary)]">Not yet weighed</span>
      ),
  },
  {
    key: 'onhand',
    header: 'On hand',
    numeric: true,
    render: (row) =>
      Number(row.onHandKg) > 0 ? (
        <Quantity
          quantityKg={row.onHandKg}
          keshaCount={row.onHandKesha}
          size="sm"
          layout="stacked"
          className="items-end"
        />
      ) : (
        <span className="text-xs text-[var(--text-tertiary)]">—</span>
      ),
  },
  {
    key: 'receivedAt',
    header: 'Arrived',
    secondary: true,
    render: (row) => <When value={row.receivedAt} dateOnly />,
  },
  {
    key: 'status',
    header: 'Stage',
    render: (row) => (
      <ConsignmentStatusBadge status={row.status as ConsignmentStatus} size="sm" />
    ),
  },
]

/**
 * The consignment register.
 *
 * "Received" is what arrived; "on hand" is what is still here. They differ the moment
 * anything is processed or dispatched, and showing both in one row is what stops someone
 * quoting an arrival figure as a custody figure — the most common way these two get confused.
 */
export default async function ConsignmentsPage(props: PageProps<'/consignments'>) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness } = await pageContext()
  const status = firstParam(search, 'status')

  const [page, counts] = await Promise.all([
    pageQuery(emptyListPage<ConsignmentRow>(), (tx) =>
      listConsignments(tx, { status, search: params.q, cursor: params.cursor }),
    ),
    pageQuery({} as Readonly<Record<string, number>>, consignmentStatusCounts),
  ])

  const tabs = [
    { value: '', label: 'All' },
    { value: 'STORED', label: 'Stored', count: counts.STORED },
    { value: 'IN_PROCESS', label: 'In process', count: counts.IN_PROCESS },
    {
      value: 'AWAITING_ACCEPTANCE',
      label: 'Awaiting acceptance',
      count: counts.AWAITING_ACCEPTANCE,
    },
    { value: 'RELEASE_REQUESTED', label: 'Release requested', count: counts.RELEASE_REQUESTED },
    { value: 'DISPATCHED', label: 'Dispatched', count: counts.DISPATCHED },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Consignments"
        description="One reference follows the coffee from the customer's request letter to the dispatch truck."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <ListToolbar
          trailing={
            <SearchForm
              action="/consignments"
              defaultValue={params.q}
              hidden={params}
              placeholder="Reference or customer…"
            />
          }
        >
          <FilterTabs
            options={tabs}
            active={status ?? ''}
            basePath="/consignments"
            params={params}
          />
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          rowHref={(row) => `/consignments/${row.id}`}
          caption="Consignments"
          empty={{
            title: 'No consignments here',
            description:
              'A consignment is created when a delivery request is approved. Approve one to see it here.',
            icon: <Icon name="consignments" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/consignments"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
