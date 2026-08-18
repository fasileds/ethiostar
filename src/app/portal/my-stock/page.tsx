import type { Metadata } from 'next'
import { pageContext, pageQuery, listParams, emptyListPage } from '@server/page-data'
import { listStockOnHand, type StockOnHandRow } from '@modules/stock'
import { totalInCustody } from '@modules/portal'
import { PageHeader, Card, StatCard } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { SearchForm, ListToolbar } from '@ui/patterns/FilterBar'
import { Quantity } from '@ui/patterns/Quantity'
import { When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'My stock' }

/**
 * The customer's own stock statement.
 *
 * The room and section are shown deliberately. The client document exposes location to
 * customers "at EthioStar's discretion", and showing it is what turns "you have 40 tonnes
 * somewhere" into a statement a customer can act on — they can send someone to look at it.
 */
const COLUMNS: ReadonlyArray<Column<StockOnHandRow>> = [
  { key: 'lot', header: 'Lot', render: (row) => row.lotReference },
  {
    key: 'consignment',
    header: 'Consignment',
    render: (row) => <span className="numeric">{row.consignmentReference}</span>,
  },
  { key: 'coffee', header: 'Coffee', render: (row) => row.coffeeTypeName ?? '—' },
  {
    key: 'location',
    header: 'Stored at',
    secondary: true,
    render: (row) => (
      <span className="numeric text-xs">
        {row.roomCode} · {row.sectionCode}
      </span>
    ),
  },
  {
    key: 'quantity',
    header: 'Quantity',
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

export default async function MyStockPage(props: PageProps<'/portal/my-stock'>) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness, customerId } = await pageContext()

  const [page, custody] = await Promise.all([
    pageQuery(emptyListPage<StockOnHandRow>(), (tx) =>
      listStockOnHand(tx, {
        customerId: customerId ?? undefined,
        search: params.q,
        cursor: params.cursor,
      }),
    ),
    pageQuery({ quantityKg: '0', keshaCount: 0, lots: 0 }, (tx) =>
      totalInCustody(tx, customerId ?? undefined),
    ),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="My stock"
        description="Every lot of your coffee currently held by EthioStar, and where it is stored."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total held"
          intent="brand"
          value={
            <Quantity
              quantityKg={custody.quantityKg}
              keshaCount={custody.keshaCount}
              size="lg"
              layout="stacked"
            />
          }
          hint="In EthioStar's custody"
          icon={<Icon name="stock" />}
        />
        <StatCard
          label="Lots"
          value={<span className="numeric text-3xl font-semibold">{custody.lots}</span>}
          hint="Separate parcels"
          icon={<Icon name="consignments" />}
        />
        <StatCard
          label="Kesha"
          value={<span className="numeric text-3xl font-semibold">{custody.keshaCount}</span>}
          hint="Your bags, tracked separately"
          icon={<Icon name="bags" />}
        />
      </div>

      <Card padded={false}>
        <ListToolbar
          trailing={
            <SearchForm
              action="/portal/my-stock"
              defaultValue={params.q}
              hidden={params}
              placeholder="Lot or consignment…"
            />
          }
        >
          <h2 className="text-sm font-medium">Lots</h2>
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => `${row.lotId}-${row.locationId}`}
          caption="My stock on hand"
          empty={{
            title: 'Nothing in storage',
            description:
              'Once EthioStar receives a delivery from you, every lot appears here with its location.',
            icon: <Icon name="stock" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/portal/my-stock"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
