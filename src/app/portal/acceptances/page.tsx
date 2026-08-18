import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import { listAcceptances, type AcceptanceRow } from '@modules/acceptance'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, ListToolbar } from '@ui/patterns/FilterBar'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Quantity } from '@ui/patterns/Quantity'
import { When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Acceptances' }

const COLUMNS: ReadonlyArray<Column<AcceptanceRow>> = [
  { key: 'reference', header: 'Reference', render: (row) => row.reference },
  {
    key: 'consignment',
    header: 'Consignment',
    render: (row) => <span className="numeric">{row.consignmentReference}</span>,
  },
  {
    key: 'presented',
    header: 'Presented to you',
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
    header: 'You accepted',
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
    key: 'signed',
    header: 'Signed',
    secondary: true,
    render: (row) => <When value={row.signedAt} />,
  },
  { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
]

/**
 * Mirt Merekebiya, from the customer's side.
 *
 * A signed acceptance is immutable — that is what makes it worth signing. If the figures are
 * wrong, the correction is a NEW record that supersedes this one, and both remain visible.
 */
export default async function PortalAcceptancesPage(props: PageProps<'/portal/acceptances'>) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness, customerId } = await pageContext()
  const status = firstParam(search, 'status')

  const page = await pageQuery(emptyListPage<AcceptanceRow>(), (tx) =>
    listAcceptances(tx, {
      customerId: customerId ?? undefined,
      status,
      cursor: params.cursor,
    }),
  )

  const tabs = [
    { value: '', label: 'All' },
    { value: 'PRESENTED', label: 'Awaiting your signature' },
    { value: 'ACCEPTED', label: 'Accepted' },
    { value: 'DISPUTED', label: 'Disputed' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Acceptances"
        description="Processed output presented for your approval. Nothing can be collected until it is signed."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <ListToolbar>
          <FilterTabs
            options={tabs}
            active={status ?? ''}
            basePath="/portal/acceptances"
            params={params}
          />
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          caption="My acceptances"
          empty={{
            title: 'Nothing to accept',
            description:
              'When a processing job finishes, EthioStar presents the output here for you to check and sign for.',
            icon: <Icon name="acceptance" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/portal/acceptances"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
