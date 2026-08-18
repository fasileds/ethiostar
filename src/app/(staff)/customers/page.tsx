import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import { listCustomers, customerStatusCounts, type CustomerRow } from '@modules/customers'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, SearchForm, ListToolbar } from '@ui/patterns/FilterBar'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Quantity } from '@ui/patterns/Quantity'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Customers' }

const COLUMNS: ReadonlyArray<Column<CustomerRow>> = [
  { key: 'code', header: 'Code', render: (row) => row.code },
  {
    key: 'name',
    header: 'Customer',
    render: (row) => (
      <div className="min-w-0">
        <div className="truncate">{row.legalName}</div>
        {row.tradeName ? (
          <div className="truncate text-xs text-[var(--text-tertiary)]">{row.tradeName}</div>
        ) : null}
      </div>
    ),
  },
  {
    key: 'type',
    header: 'Business type',
    secondary: true,
    render: (row) => row.businessTypeName ?? '—',
  },
  {
    key: 'contact',
    header: 'Contact',
    secondary: true,
    render: (row) => (
      <div className="numeric min-w-0 truncate text-xs">{row.primaryPhone ?? '—'}</div>
    ),
  },
  {
    key: 'custody',
    header: 'In custody',
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
        <span className="text-xs text-[var(--text-tertiary)]">Nothing held</span>
      ),
  },
  { key: 'open', header: 'Open', numeric: true, render: (row) => row.openConsignments },
  { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
]

/**
 * M07 — the customer register.
 *
 * There is no "New customer" button, and that is deliberate: a customer record is created
 * only by approving an application, in the same transaction that closes it. A manual create
 * path would produce customers nobody did KYC on.
 */
export default async function CustomersPage(props: PageProps<'/customers'>) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness } = await pageContext()
  const status = firstParam(search, 'status')

  const [page, counts] = await Promise.all([
    pageQuery(emptyListPage<CustomerRow>(), (tx) =>
      listCustomers(tx, { status, search: params.q, cursor: params.cursor }),
    ),
    pageQuery({} as Readonly<Record<string, number>>, customerStatusCounts),
  ])

  const tabs = [
    { value: '', label: 'All' },
    { value: 'ACTIVE', label: 'Active', count: counts.ACTIVE },
    { value: 'SUSPENDED', label: 'Suspended', count: counts.SUSPENDED },
    { value: 'CLOSED', label: 'Closed', count: counts.CLOSED },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Everyone EthioStar stores or processes coffee for. Records are created by approving an application."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <ListToolbar
          trailing={
            <SearchForm
              action="/customers"
              defaultValue={params.q}
              hidden={params}
              placeholder="Name, code or TIN…"
            />
          }
        >
          <FilterTabs
            options={tabs}
            active={status ?? ''}
            basePath="/customers"
            params={params}
          />
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          rowHref={(row) => `/customers/${row.id}`}
          caption="Customers"
          empty={{
            title: 'No customers yet',
            description:
              'Customers appear here once their application is approved. Check the Applications queue.',
            icon: <Icon name="customers" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/customers"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
