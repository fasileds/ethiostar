import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import {
  listAcceptances,
  acceptanceStatusCounts,
  type AcceptanceRow,
} from '@modules/acceptance'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, SearchForm, ListToolbar } from '@ui/patterns/FilterBar'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Quantity, Percentage } from '@ui/patterns/Quantity'
import { When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Acceptance' }

const COLUMNS: ReadonlyArray<Column<AcceptanceRow>> = [
  { key: 'reference', header: 'Reference', render: (row) => row.reference },
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
    key: 'presented',
    header: 'Presented',
    numeric: true,
    render: (row) => (
      <Quantity
        quantityKg={row.presentedQuantityKg}
        keshaCount={row.presentedKeshaCount ?? 0}
        size="sm"
        layout="stacked"
        className="items-end"
      />
    ),
  },
  {
    key: 'accepted',
    header: 'Accepted',
    numeric: true,
    render: (row) =>
      row.acceptedQuantityKg ? (
        <Quantity
          quantityKg={row.acceptedQuantityKg}
          keshaCount={row.acceptedKeshaCount ?? 0}
          size="sm"
          layout="stacked"
          className="items-end"
        />
      ) : (
        <span className="text-xs text-[var(--text-tertiary)]">Not signed</span>
      ),
  },
  {
    key: 'yield',
    header: 'Yield',
    numeric: true,
    secondary: true,
    render: (row) =>
      row.yieldPct ? (
        <Percentage value={row.yieldPct} size="sm" />
      ) : (
        <span className="text-xs text-[var(--text-tertiary)]">—</span>
      ),
  },
  {
    key: 'signatory',
    header: 'Signed by',
    secondary: true,
    render: (row) =>
      row.customerRepName ?? <span className="text-[var(--text-tertiary)]">—</span>,
  },
  {
    key: 'signedAt',
    header: 'Signed',
    secondary: true,
    render: (row) => <When value={row.signedAt} />,
  },
  { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
]

/**
 * M16 — Mirt Merekebiya.
 *
 * Opens on PRESENTED: output shown to a customer who has not yet signed. Coffee sitting in
 * that state is coffee nobody can dispatch and nobody has agreed on, so it is the queue that
 * costs money to leave alone.
 *
 * DISPUTED is a first-class tab, not an error state. A customer disagreeing with a reject
 * percentage is an expected outcome, and the coffee must not move while it is open.
 */
export default async function AcceptancePage(props: PageProps<'/acceptance'>) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness } = await pageContext()
  const status = firstParam(search, 'status') ?? 'PRESENTED'

  const [page, counts] = await Promise.all([
    pageQuery(emptyListPage<AcceptanceRow>(), (tx) =>
      listAcceptances(tx, {
        status: status === 'ALL' ? undefined : status,
        search: params.q,
        cursor: params.cursor,
      }),
    ),
    pageQuery({} as Readonly<Record<string, number>>, acceptanceStatusCounts),
  ])

  const tabs = [
    { value: 'PRESENTED', label: 'Awaiting signature', count: counts.PRESENTED },
    { value: 'DISPUTED', label: 'Disputed', count: counts.DISPUTED },
    { value: 'ACCEPTED', label: 'Accepted', count: counts.ACCEPTED },
    { value: 'PARTIALLY_ACCEPTED', label: 'Partial', count: counts.PARTIALLY_ACCEPTED },
    { value: 'ALL', label: 'All' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mirt Merekebiya"
        description="Customer acceptance of processed output. Until it is signed the coffee is still EthioStar's responsibility, and dispatch is blocked."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <ListToolbar
          trailing={
            <SearchForm
              action="/acceptance"
              defaultValue={params.q}
              hidden={params}
              placeholder="Reference, consignment or customer…"
            />
          }
        >
          <FilterTabs options={tabs} active={status} basePath="/acceptance" params={params} />
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          rowHref={(row) => `/acceptance/${row.id}`}
          caption="Acceptance records"
          empty={{
            title:
              status === 'PRESENTED'
                ? 'Nothing awaiting signature'
                : 'No acceptance records here',
            description:
              status === 'PRESENTED'
                ? 'Output presented to a customer appears here until they sign for it.'
                : 'Try a different status, or clear the search.',
            icon: <Icon name="acceptance" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/acceptance"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
