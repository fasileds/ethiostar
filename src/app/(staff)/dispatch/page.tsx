import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import {
  listDispatchOrders,
  dispatchStatusCounts,
  listReleaseRequests,
  type DispatchOrderRow,
  type ReleaseRequestRow,
} from '@modules/dispatch'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, SearchForm, ListToolbar } from '@ui/patterns/FilterBar'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Quantity } from '@ui/patterns/Quantity'
import { When, OnDate } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Dispatch' }

const COLUMNS: ReadonlyArray<Column<DispatchOrderRow>> = [
  { key: 'reference', header: 'Order', render: (row) => row.reference },
  {
    key: 'customer',
    header: 'Customer',
    render: (row) => (
      <div className="min-w-0">
        <div className="truncate">{row.customerName}</div>
        <div className="numeric truncate text-xs text-[var(--text-tertiary)]">
          {row.consignmentReference ?? ''}
        </div>
      </div>
    ),
  },
  {
    key: 'vehicle',
    header: 'Vehicle',
    render: (row) => (
      <div className="min-w-0">
        <div className="numeric">{row.vehiclePlate ?? '—'}</div>
        <div className="truncate text-xs text-[var(--text-tertiary)]">
          {row.driverName ?? ''}
        </div>
      </div>
    ),
  },
  {
    key: 'destination',
    header: 'Destination',
    secondary: true,
    render: (row) => row.destination ?? '—',
  },
  {
    key: 'quantity',
    header: 'Loaded',
    numeric: true,
    render: (row) => (
      <Quantity
        quantityKg={row.loadedQuantityKg ?? row.plannedQuantityKg}
        keshaCount={row.loadedKeshaCount ?? row.plannedKeshaCount ?? 0}
        size="sm"
        layout="stacked"
        className="items-end"
      />
    ),
  },
  {
    key: 'clearance',
    header: 'Clearance',
    render: (row) =>
      row.clearanceStatus ? (
        <StatusChip status={row.clearanceStatus} />
      ) : (
        <span className="text-xs text-[var(--text-tertiary)]">Not checked</span>
      ),
  },
  {
    key: 'gateOut',
    header: 'Gate out',
    secondary: true,
    render: (row) => <When value={row.gateOutAt} />,
  },
  { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
]

/**
 * M17 — dispatch orders, and the release requests waiting to become one.
 *
 * The clearance column shows the verdict as it was FROZEN on the order. The gate recomputes
 * it live before anything moves — see /gate — because this column records what was true when
 * it was written, and the gate needs what is true now.
 */
export default async function DispatchPage(props: PageProps<'/dispatch'>) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness } = await pageContext()
  const status = firstParam(search, 'status')

  const [page, counts, releases] = await Promise.all([
    pageQuery(emptyListPage<DispatchOrderRow>(), (tx) =>
      listDispatchOrders(tx, { status, search: params.q, cursor: params.cursor }),
    ),
    pageQuery({} as Readonly<Record<string, number>>, dispatchStatusCounts),
    pageQuery(emptyListPage<ReleaseRequestRow>(), (tx) =>
      listReleaseRequests(tx, { status: 'SUBMITTED', limit: 10 }),
    ),
  ])

  const tabs = [
    { value: '', label: 'All' },
    { value: 'PLANNED', label: 'Planned', count: counts.PLANNED },
    { value: 'LOADING', label: 'Loading', count: counts.LOADING },
    { value: 'LOADED', label: 'Loaded', count: counts.LOADED },
    { value: 'DISPATCHED', label: 'Dispatched', count: counts.DISPATCHED },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispatch"
        description="Loading and release. Nothing reaches the gate without an approved release and a signed acceptance."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      {/* ── Release requests awaiting approval ────────────────────────────── */}
      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Release requests to approve"
            description="A release must be authorised by a contact who holds that permission on the customer record."
          />
        </div>

        {releases.items.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
            Nothing waiting for approval.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {releases.items.map((release) => (
              <li
                key={release.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
              >
                <span className="numeric shrink-0 font-medium">{release.reference}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{release.customerName}</span>
                <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
                  {release.authorisedByName ? (
                    `Authorised by ${release.authorisedByName}`
                  ) : (
                    <span className="text-warning-900 dark:text-warning-100">
                      No authorising contact
                    </span>
                  )}
                </span>
                <Quantity
                  quantityKg={release.requestedQuantityKg}
                  keshaCount={release.requestedKeshaCount ?? 0}
                  size="sm"
                />
                <OnDate
                  value={release.requestedCollectionOn}
                  className="shrink-0 text-xs text-[var(--text-tertiary)]"
                />
                <StatusChip status={release.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Dispatch orders ───────────────────────────────────────────────── */}
      <Card padded={false}>
        <ListToolbar
          trailing={
            <SearchForm
              action="/dispatch"
              defaultValue={params.q}
              hidden={params}
              placeholder="Order, plate or customer…"
            />
          }
        >
          <FilterTabs
            options={tabs}
            active={status ?? ''}
            basePath="/dispatch"
            params={params}
          />
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          rowHref={(row) => `/dispatch/${row.id}`}
          caption="Dispatch orders"
          empty={{
            title: 'No dispatch orders',
            description:
              'An order is raised from an approved release request, ready for loading.',
            icon: <Icon name="dispatch" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/dispatch"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
