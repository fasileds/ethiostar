import type { Metadata } from 'next'
import Link from 'next/link'
import { pageContext, pageQuery, listParams, emptyListPage } from '@server/page-data'
import {
  listStockOnHand,
  stockByCustomer,
  reconciliationVariances,
  type StockOnHandRow,
  type CustomerStockSummary,
  type ReconciliationVariance,
} from '@modules/stock'
import { PageHeader, Card, CardHeader, StatCard } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { SearchForm, ListToolbar } from '@ui/patterns/FilterBar'
import { Quantity } from '@ui/patterns/Quantity'
import { When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'
import { Alert } from '@ui/primitives/Alert'
import { ButtonLink } from '@ui/primitives/Button'

export const metadata: Metadata = { title: 'Stock' }

const COLUMNS: ReadonlyArray<Column<StockOnHandRow>> = [
  { key: 'lot', header: 'Lot', render: (row) => row.lotReference },
  {
    key: 'consignment',
    header: 'Consignment',
    render: (row) => <span className="numeric">{row.consignmentReference}</span>,
  },
  {
    key: 'customer',
    header: 'Customer',
    render: (row) => <span className="block truncate">{row.customerName}</span>,
  },
  {
    key: 'location',
    header: 'Location',
    render: (row) => (
      <span className="numeric text-xs">
        {row.warehouseCode} · {row.roomCode} · {row.sectionCode}
      </span>
    ),
  },
  {
    key: 'coffee',
    header: 'Coffee',
    secondary: true,
    render: (row) => row.coffeeTypeName ?? '—',
  },
  {
    key: 'quantity',
    header: 'On hand',
    numeric: true,
    render: (row) => (
      <Quantity
        quantityKg={row.quantityKg}
        keshaCount={row.keshaCount}
        size="sm"
        layout="stacked"
        className="items-end"
      />
    ),
  },
  {
    key: 'updated',
    header: 'Last moved',
    secondary: true,
    render: (row) => <When value={row.updatedAt} />,
  },
]

/**
 * Stock on hand.
 *
 * The reconciliation panel is at the top, not buried in an admin screen. It compares the
 * ledger against the balance projection, and anything it lists is a discrepancy someone must
 * resolve before the figures below can be trusted. Putting it where the figures are is what
 * makes it get read.
 */
export default async function StockPage(props: PageProps<'/stock'>) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness } = await pageContext()

  const [page, byCustomer, variances] = await Promise.all([
    pageQuery(emptyListPage<StockOnHandRow>(), (tx) =>
      listStockOnHand(tx, { search: params.q, cursor: params.cursor }),
    ),
    pageQuery([] as CustomerStockSummary[], (tx) => stockByCustomer(tx, 6)),
    pageQuery([] as ReconciliationVariance[], reconciliationVariances),
  ])

  const totalKg = byCustomer.reduce((sum, row) => sum + Number(row.quantityKg), 0)
  const totalKesha = byCustomer.reduce((sum, row) => sum + row.keshaCount, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock"
        description="Every kilogram in EthioStar's custody, at a defined location. Balances are a projection of the append-only ledger."
        actions={
          <ButtonLink href="/stock/movements" variant="secondary">
            Movement history
          </ButtonLink>
        }
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      {variances.length > 0 ? (
        <Alert tone="danger" title="The ledger and the balance projection disagree">
          <p>
            {variances.length} {variances.length === 1 ? 'lot' : 'lots'} where the sum of
            movements does not equal the recorded balance. The ledger is the source of truth —
            rebuild the projection rather than editing a balance.
          </p>
          <ul className="numeric mt-2 space-y-0.5 text-xs">
            {variances.slice(0, 5).map((variance) => (
              <li key={`${variance.lotId}-${variance.locationId}`}>
                {variance.lotReference} at {variance.sectionCode}: ledger {variance.ledgerKg}{' '}
                kg, balance {variance.balanceKg} kg — difference {variance.differenceKg} kg
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total in custody"
          intent="brand"
          value={
            <Quantity
              quantityKg={totalKg.toFixed(3)}
              keshaCount={totalKesha}
              size="lg"
              layout="stacked"
            />
          }
          hint="Across the top customers shown"
          icon={<Icon name="stock" />}
        />

        <Card className="sm:col-span-2 lg:col-span-3" padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader title="By customer" description="Largest holdings first." />
          </div>
          {byCustomer.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
              Nothing in custody.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {byCustomer.map((row) => (
                <li
                  key={row.customerId}
                  className="flex items-center gap-3 px-4 py-2.5 sm:px-5"
                >
                  <Link
                    href={`/customers/${row.customerId}`}
                    className="min-w-0 flex-1 truncate rounded text-sm font-medium text-[var(--text-brand)] hover:underline"
                  >
                    {row.customerName}
                  </Link>
                  <span className="numeric shrink-0 text-2xs text-[var(--text-tertiary)]">
                    {row.lots} lots
                  </span>
                  <Quantity quantityKg={row.quantityKg} keshaCount={row.keshaCount} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card padded={false}>
        <ListToolbar
          trailing={
            <SearchForm
              action="/stock"
              defaultValue={params.q}
              hidden={params}
              placeholder="Lot, consignment, customer or section…"
            />
          }
        >
          <h2 className="text-sm font-medium">Lots on hand</h2>
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => `${row.lotId}-${row.locationId}`}
          rowHref={(row) => `/consignments/${row.consignmentId}`}
          caption="Stock on hand by lot and location"
          empty={{
            title: 'Nothing in custody',
            description:
              'Stock appears once a goods receipt is posted. Until then the ledger has no rows.',
            icon: <Icon name="stock" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/stock"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
