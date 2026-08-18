import type { Metadata } from 'next'
import Link from 'next/link'
import { pageContext, pageQuery } from '@server/page-data'
import {
  gateQueue,
  recentGateEvents,
  vehiclesOnSite,
  type GateQueueEntry,
  type GateEventRow,
  type OnSiteVehicle,
} from '@modules/dispatch'
import { PageHeader, Card, CardHeader, EmptyState, StatCard } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { Quantity } from '@ui/patterns/Quantity'
import { When, Elapsed } from '@ui/patterns/DateTime'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Icon } from '@ui/layout/Icon'
import { systemClock } from '@core/clock/clock'

export const metadata: Metadata = { title: 'Gate' }

/**
 * M17 — the gate.
 *
 * The highest-stakes screen in the system: coffee that leaves cannot be un-left. It is used
 * by a guard, outdoors, on a phone, under time pressure from a driver who wants to go.
 *
 * So the answer is binary and it comes first. A CLEARED order shows a large green panel; a
 * BLOCKED one shows the reasons in plain words, because "blocked" with no explanation gets
 * overridden by whoever is standing there with a phone. The reasons are recomputed on every
 * load — an order cleared on Monday against an acceptance disputed on Tuesday must not pass
 * on Wednesday.
 */
export default async function GatePage() {
  const { readiness } = await pageContext()
  const now = systemClock.now()

  const [queue, onSite, events] = await Promise.all([
    pageQuery([] as GateQueueEntry[], gateQueue),
    pageQuery([] as OnSiteVehicle[], vehiclesOnSite),
    pageQuery([] as GateEventRow[], (tx) => recentGateEvents(tx, 20)),
  ])

  const cleared = queue.filter((entry) => entry.blockers.length === 0)
  const blocked = queue.filter((entry) => entry.blockers.length > 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gate"
        description="Nothing leaves without a clearance. Check the order, then record the movement."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          label="Cleared to go"
          intent={cleared.length > 0 ? 'success' : 'neutral'}
          value={<span className="numeric text-3xl font-semibold">{cleared.length}</span>}
          hint="All checks pass"
          icon={<Icon name="dispatch" />}
        />
        <StatCard
          label="Blocked"
          intent={blocked.length > 0 ? 'warn' : 'neutral'}
          value={<span className="numeric text-3xl font-semibold">{blocked.length}</span>}
          hint="Do not release"
          icon={<Icon name="gate" />}
        />
        <StatCard
          label="On site"
          value={<span className="numeric text-3xl font-semibold">{onSite.length}</span>}
          hint="Vehicles inside"
          icon={<Icon name="delivery" />}
        />
      </div>

      {/* ── The queue ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="queue" className="space-y-3">
        <h2 id="queue" className="text-lg font-semibold">
          Waiting at the gate
        </h2>

        {queue.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            description="Dispatch orders appear here once loading starts. Each one is checked against its release request and its Mirt Merekebiya acceptance."
            icon={<Icon name="gate" className="size-8" />}
          />
        ) : (
          <ul className="space-y-3">
            {[...cleared, ...blocked].map((entry) => (
              <GateCard key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── On site ─────────────────────────────────────────────────────── */}
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Vehicles on site"
              description="Last recorded movement was inward."
            />
          </div>
          {onSite.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
              No vehicles inside.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {onSite.map((vehicle) => (
                <li
                  key={vehicle.vehiclePlate}
                  className="flex items-center gap-3 px-4 py-2.5 sm:px-5"
                >
                  <span className="numeric font-semibold">{vehicle.vehiclePlate}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">
                    {vehicle.driverName ?? 'Driver not recorded'}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
                    <Elapsed since={vehicle.since} now={now} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Recent movements ────────────────────────────────────────────── */}
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Recent movements"
              description="Append-only. A manual entry always carries a reason."
            />
          </div>
          {events.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
              No gate events recorded.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {events.map((event) => (
                <li key={event.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-semibold ${
                      event.direction === 'IN'
                        ? 'bg-info-50 text-info-700 dark:bg-info-900/25 dark:text-info-100'
                        : 'bg-success-50 text-success-700 dark:bg-success-900/25 dark:text-success-100'
                    }`}
                  >
                    {event.direction}
                  </span>
                  <span className="numeric shrink-0 font-medium">{event.vehiclePlate}</span>
                  {event.captureMethod === 'MANUAL' ? (
                    <span
                      className="shrink-0 rounded bg-warning-50 px-1.5 py-0.5 text-2xs text-warning-900 dark:bg-warning-900/25 dark:text-warning-100"
                      title={event.manualReason ?? undefined}
                    >
                      Manual
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-tertiary)]">
                    {event.driverName ?? ''}
                  </span>
                  <When
                    value={event.occurredAt}
                    className="shrink-0 text-xs text-[var(--text-tertiary)]"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function GateCard({ entry }: { readonly entry: GateQueueEntry }) {
  const clear = entry.blockers.length === 0

  return (
    <li
      className={`rounded-lg p-4 ring-1 sm:p-5 ${
        clear
          ? 'bg-success-50 ring-success-100 dark:bg-success-900/15 dark:ring-success-900'
          : 'bg-danger-50 ring-danger-100 dark:bg-danger-900/15 dark:ring-danger-900'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dispatch/${entry.id}`}
              className="numeric rounded text-lg font-semibold hover:underline"
            >
              {entry.reference}
            </Link>
            <StatusChip status={entry.status} />
          </div>
          <p className="mt-1 truncate text-base">{entry.customerName}</p>
          <p className="numeric mt-0.5 text-sm text-[var(--text-secondary)]">
            {entry.vehiclePlate ?? 'No plate'} · {entry.driverName ?? 'No driver'}
            {entry.destination ? ` · ${entry.destination}` : ''}
          </p>
        </div>

        <Quantity
          quantityKg={entry.loadedQuantityKg ?? entry.plannedQuantityKg}
          keshaCount={entry.loadedKeshaCount ?? entry.plannedKeshaCount ?? 0}
          size="lg"
          layout="stacked"
          className="items-end"
        />
      </div>

      {clear ? (
        <div className="mt-4 flex min-h-[var(--size-touch-lg)] items-center justify-center gap-2 rounded-md bg-success-700 px-4 text-base font-semibold text-white">
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-5" aria-hidden>
            <path d="M8.1 13.4 4.7 10l-1.2 1.2 4.6 4.6 9-9L15.9 5.6z" />
          </svg>
          Cleared — record gate out
        </div>
      ) : (
        <div className="mt-4 rounded-md bg-[var(--surface-raised)] p-3 ring-1 ring-danger-100 dark:ring-danger-900">
          <p className="flex items-center gap-2 text-sm font-semibold text-danger-700 dark:text-danger-100">
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="size-4 shrink-0"
              aria-hidden
            >
              <path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 3a1 1 0 0 0-1 1v4.5a1 1 0 0 0 2 0V6a1 1 0 0 0-1-1Zm0 9.6a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2Z" />
            </svg>
            Do not release
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {entry.blockers.map((blocker) => (
              <li key={blocker} className="flex gap-2">
                <span aria-hidden className="text-danger-700 dark:text-danger-100">
                  •
                </span>
                {blocker}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}
