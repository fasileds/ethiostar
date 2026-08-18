import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import { listAppointments, type AppointmentRow } from '@modules/scheduling'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, ListToolbar } from '@ui/patterns/FilterBar'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Quantity } from '@ui/patterns/Quantity'
import { When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Appointments' }

const COLUMNS: ReadonlyArray<Column<AppointmentRow>> = [
  { key: 'reference', header: 'Reference', render: (row) => row.reference },
  { key: 'when', header: 'Scheduled', render: (row) => <When value={row.scheduledStartAt} /> },
  { key: 'machine', header: 'Line', secondary: true, render: (row) => row.machineName },
  {
    key: 'quantity',
    header: 'Planned',
    numeric: true,
    render: (row) => (
      <Quantity
        quantityKg={row.plannedQuantityKg}
        keshaCount={row.plannedKeshaCount ?? 0}
        size="sm"
        layout="stacked"
        className="items-end"
      />
    ),
  },
  {
    key: 'delay',
    header: 'Delay',
    numeric: true,
    // "On time" is rendered explicitly rather than left blank: a customer planning a journey
    // wants the absence of a delay CONFIRMED, not inferred from an empty cell.
    render: (row) =>
      row.cumulativeDelayMinutes > 0 ? (
        <span className="numeric font-semibold text-warning-900 dark:text-warning-100">
          +{row.cumulativeDelayMinutes} min
        </span>
      ) : (
        <span className="text-xs text-[var(--text-tertiary)]">On time</span>
      ),
  },
  { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
]

/**
 * The customer's processing appointments.
 *
 * The delay column is the point of this screen. The client's complaint was that a slipped
 * appointment is discovered on arrival; surfacing the accumulated delay here, with its
 * reason, is what turns that into a message rather than a wasted journey.
 */
export default async function PortalAppointmentsPage(props: PageProps<'/portal/appointments'>) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness, customerId } = await pageContext()
  const status = firstParam(search, 'status')

  const page = await pageQuery(emptyListPage<AppointmentRow>(), (tx) =>
    listAppointments(tx, {
      customerId: customerId ?? undefined,
      status,
      cursor: params.cursor,
    }),
  )

  const tabs = [
    { value: '', label: 'All' },
    { value: 'CONFIRMED', label: 'Confirmed' },
    { value: 'IN_PROGRESS', label: 'Running' },
    { value: 'COMPLETED', label: 'Completed' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appointments"
        description="When your coffee is scheduled to run. If a slot moves, the delay and the reason appear here."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <ListToolbar>
          <FilterTabs
            options={tabs}
            active={status ?? ''}
            basePath="/portal/appointments"
            params={params}
          />
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          caption="My appointments"
          empty={{
            title: 'No appointments',
            description:
              'An appointment is created when EthioStar approves a processing request and assigns it to a line.',
            icon: <Icon name="calendar" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/portal/appointments"
          params={params}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}
