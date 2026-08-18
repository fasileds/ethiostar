import type { Metadata } from 'next'
import Link from 'next/link'
import { pageContext, pageQuery, firstParam } from '@server/page-data'
import { dayBoard, recentDelays, type MachineDay, type DelayRow } from '@modules/scheduling'
import { PageHeader, Card, CardHeader, EmptyState } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Quantity } from '@ui/patterns/Quantity'
import { OnDate, When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'
import { systemClock } from '@core/clock/clock'
import { toBusinessDate, addBusinessDays, businessDate } from '@core/utils/date'

export const metadata: Metadata = { title: 'Scheduling' }

/**
 * M14 — the day board.
 *
 * Ordered by `sequence_no` within each machine, not by start time. Start time is what MOVES
 * when a delay cascades; ordering by it would reshuffle the board under the scheduler at
 * exactly the moment they need it to hold still.
 *
 * A booking carrying a delay shows how much it has slipped and whether the customer has been
 * told — the client's specific complaint was that nobody finds out until the customer arrives.
 */
export default async function SchedulingPage(props: PageProps<'/scheduling'>) {
  const search = await props.searchParams
  const { readiness } = await pageContext()

  const requested = firstParam(search, 'on')
  const today = toBusinessDate(systemClock.now())
  const on = requested ?? today

  const [board, delays] = await Promise.all([
    pageQuery([] as MachineDay[], (tx) => dayBoard(tx, on)),
    pageQuery([] as DelayRow[], (tx) => recentDelays(tx, 8)),
  ])

  const previous = addBusinessDays(businessDate(on), -1)
  const next = addBusinessDays(businessDate(on), 1)
  const booked = board.reduce((sum, machine) => sum + machine.appointments.length, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scheduling"
        description="Every machine, every booking, in the order it will run."
        meta={
          <div className="flex items-center gap-1">
            <Link
              href={`/scheduling?on=${previous}`}
              className="inline-flex size-8 items-center justify-center rounded-md ring-1 ring-[var(--border-default)] hover:bg-[var(--surface-sunken)]"
              aria-label="Previous day"
            >
              ←
            </Link>
            <span className="px-2 text-sm font-medium">
              <OnDate value={on} />
            </span>
            <Link
              href={`/scheduling?on=${next}`}
              className="inline-flex size-8 items-center justify-center rounded-md ring-1 ring-[var(--border-default)] hover:bg-[var(--surface-sunken)]"
              aria-label="Next day"
            >
              →
            </Link>
            {on !== today ? (
              <Link
                href="/scheduling"
                className="ml-2 rounded text-sm text-[var(--text-brand)] hover:underline"
              >
                Today
              </Link>
            ) : null}
          </div>
        }
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      {board.length === 0 ? (
        <EmptyState
          title="No machines configured"
          description="Add machines and their daily capacity in Administration before appointments can be booked."
          icon={<Icon name="processing" className="size-8" />}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            <span className="numeric font-semibold">{booked}</span>{' '}
            {booked === 1 ? 'booking' : 'bookings'} across {board.length}{' '}
            {board.length === 1 ? 'machine' : 'machines'}.
          </p>

          {board.map((machine) => (
            <MachinePanel key={machine.machineId} machine={machine} />
          ))}
        </div>
      )}

      {/* ── Delays ────────────────────────────────────────────────────────── */}
      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Recent delays"
            description="Each one records how many downstream appointments it moved."
          />
        </div>
        {delays.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
            No delays recorded.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {delays.map((delay) => (
              <li
                key={delay.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
              >
                <span className="shrink-0 font-medium">{delay.machineName}</span>
                <span className="numeric shrink-0 rounded bg-warning-50 px-1.5 py-0.5 text-2xs font-semibold text-warning-900 dark:bg-warning-900/25 dark:text-warning-100">
                  +{delay.delayMinutes} min
                </span>
                <span className="shrink-0 text-xs text-[var(--text-secondary)]">
                  {delay.causeCode}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-tertiary)]">
                  {delay.description ?? ''}
                </span>
                <span className="numeric shrink-0 text-xs text-[var(--text-tertiary)]">
                  {delay.affectedAppointments} moved
                </span>
                <OnDate
                  value={delay.occurredOn}
                  className="shrink-0 text-xs text-[var(--text-tertiary)]"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function MachinePanel({ machine }: { readonly machine: MachineDay }) {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] p-4 sm:px-5">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold">
            {machine.machineName}
            <span className="numeric text-xs font-normal text-[var(--text-tertiary)]">
              {machine.machineCode}
            </span>
            <StatusChip status={machine.machineStatus} />
          </h3>
          {machine.isBlocked ? (
            <p className="mt-0.5 text-xs text-warning-900 dark:text-warning-100">
              Blocked: {machine.blockedReason}
            </p>
          ) : null}
        </div>

        <div className="text-right">
          <p className="numeric text-sm font-semibold">
            {machine.bookedKg} kg
            {machine.capacityKg ? (
              <span className="font-normal text-[var(--text-tertiary)]">
                {' '}
                / {machine.capacityKg} kg
              </span>
            ) : null}
          </p>
          <p className="text-2xs text-[var(--text-tertiary)]">
            {machine.capacityKg ? `${machine.utilisationPct}% booked` : 'No capacity set'}
          </p>
        </div>
      </div>

      {machine.appointments.length === 0 ? (
        <p className="p-4 text-sm text-[var(--text-tertiary)] sm:px-5">
          Nothing booked. This line is available.
        </p>
      ) : (
        <ol className="divide-y divide-[var(--border-subtle)]">
          {machine.appointments.map((appointment) => (
            <li
              key={appointment.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
            >
              <span className="numeric flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-xs font-semibold">
                {appointment.sequenceNo}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="numeric font-medium">{appointment.reference}</span>
                  <StatusChip status={appointment.status} />
                  {appointment.cumulativeDelayMinutes > 0 ? (
                    <span
                      className="numeric rounded bg-warning-50 px-1.5 py-0.5 text-2xs font-semibold text-warning-900 dark:bg-warning-900/25 dark:text-warning-100"
                      title={appointment.rescheduleReason ?? 'Delayed'}
                    >
                      +{appointment.cumulativeDelayMinutes} min late
                    </span>
                  ) : null}
                  {appointment.cumulativeDelayMinutes > 0 && !appointment.customerNotifiedAt ? (
                    <span className="rounded bg-danger-50 px-1.5 py-0.5 text-2xs font-semibold text-danger-700 dark:bg-danger-900/25 dark:text-danger-100">
                      Customer not told
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-sm text-[var(--text-secondary)]">
                  {appointment.customerName}
                  {appointment.consignmentReference ? (
                    <span className="numeric text-[var(--text-tertiary)]">
                      {' '}
                      · {appointment.consignmentReference}
                    </span>
                  ) : null}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <Quantity
                  quantityKg={appointment.plannedQuantityKg}
                  keshaCount={appointment.plannedKeshaCount ?? 0}
                  size="sm"
                  layout="stacked"
                  className="items-end"
                />
                <p className="mt-0.5 text-2xs text-[var(--text-tertiary)]">
                  <When value={appointment.scheduledStartAt} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
