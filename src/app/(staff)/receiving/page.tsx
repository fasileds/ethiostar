import type { Metadata } from 'next'
import Link from 'next/link'
import { pageContext, pageQuery } from '@server/page-data'
import { expectedArrivals, listGoodsReceipts, type ExpectedArrival } from '@modules/inbound'
import { PageHeader, Card, CardHeader, EmptyState, StatCard } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Quantity } from '@ui/patterns/Quantity'
import { OnDate, When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'
import { systemClock } from '@core/clock/clock'
import { toBusinessDate } from '@core/utils/date'

export const metadata: Metadata = { title: 'Receiving' }

/**
 * M11 — the receiving bay.
 *
 * This screen is used standing up, on a tablet, by someone with a clipboard in the other
 * hand and a truck waiting. Every design decision follows from that:
 *
 *  - Targets are large (`--size-touch-lg`), not dense. A mis-tap here means a truck weighed
 *    against the wrong request.
 *  - It is a WORK LIST, not a table. Each card is one arrival with its own action; there is
 *    nothing to scan across.
 *  - Vehicles already on site sort above everything, regardless of their expected date. They
 *    are the ones physically blocking the yard.
 *  - Overdue arrivals are marked, not hidden. A truck that was due yesterday still turns up.
 */
export default async function ReceivingPage() {
  const { readiness } = await pageContext()
  const today = toBusinessDate(systemClock.now())

  const [arrivals, recent] = await Promise.all([
    pageQuery([] as ExpectedArrival[], (tx) => expectedArrivals(tx, today)),
    pageQuery({ items: [], hasMore: false, nextCursor: null }, (tx) =>
      listGoodsReceipts(tx, { limit: 8 }),
    ),
  ])

  const onSite = arrivals.filter((a) => a.status === 'ARRIVED')
  const expected = arrivals.filter((a) => a.status !== 'ARRIVED')
  const overdue = arrivals.filter((a) => a.isOverdue).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receiving"
        description="Coffee arriving today. Weigh, count and record — the goods receipt is what puts it into EthioStar's custody."
        meta={<OnDate value={today} className="text-sm text-[var(--text-secondary)]" />}
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="On site now"
          intent={onSite.length > 0 ? 'warn' : 'neutral'}
          value={<span className="numeric text-3xl font-semibold">{onSite.length}</span>}
          hint="Vehicles waiting"
          icon={<Icon name="gate" />}
        />
        <StatCard
          label="Expected today"
          value={<span className="numeric text-3xl font-semibold">{expected.length}</span>}
          hint="Approved and scheduled"
          icon={<Icon name="delivery" />}
        />
        <StatCard
          label="Overdue"
          intent={overdue > 0 ? 'warn' : 'neutral'}
          value={<span className="numeric text-3xl font-semibold">{overdue}</span>}
          hint="Past their expected date"
          icon={<Icon name="calendar" />}
        />
        <StatCard
          label="Received today"
          intent="success"
          value={<span className="numeric text-3xl font-semibold">{recent.items.length}</span>}
          hint="Goods receipts raised"
          icon={<Icon name="receiving" />}
        />
      </div>

      {/* ── The work list ─────────────────────────────────────────────────── */}
      <section aria-labelledby="arrivals" className="space-y-3">
        <h2 id="arrivals" className="text-lg font-semibold">
          Arrivals
        </h2>

        {arrivals.length === 0 ? (
          <EmptyState
            title="Nothing expected today"
            description="Approved delivery requests appear here on their expected arrival date, and stay until they are received."
            icon={<Icon name="receiving" className="size-8" />}
          />
        ) : (
          <ul className="space-y-3">
            {arrivals.map((arrival) => (
              <ArrivalCard key={arrival.id} arrival={arrival} />
            ))}
          </ul>
        )}
      </section>

      {/* ── Recently received ─────────────────────────────────────────────── */}
      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Recently received"
            description="The last goods receipts raised at this branch."
          />
        </div>

        {recent.items.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
            No goods receipts yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {recent.items.map((receipt) => (
              <li
                key={receipt.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
              >
                <Link
                  href={`/receiving/${receipt.id}`}
                  className="numeric shrink-0 rounded font-medium text-[var(--text-brand)] hover:underline"
                >
                  {receipt.reference}
                </Link>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">
                  {receipt.customerName}
                </span>
                {receipt.varianceKg && Number(receipt.varianceKg) !== 0 ? (
                  <span
                    className="numeric text-xs font-semibold text-warning-900 dark:text-warning-100"
                    title="Difference between declared and received weight"
                  >
                    {Number(receipt.varianceKg) > 0 ? '+' : ''}
                    {receipt.varianceKg} kg
                  </span>
                ) : null}
                <Quantity
                  quantityKg={receipt.receivedQuantityKg}
                  keshaCount={receipt.receivedKeshaCount}
                  size="sm"
                />
                <StatusChip status={receipt.status} />
                <When
                  value={receipt.occurredAt}
                  className="text-xs text-[var(--text-tertiary)]"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

/**
 * One arrival.
 *
 * The whole card is the target, sized for a gloved thumb rather than a mouse. The reserved
 * section is shown up front because the first question at the bay is always "where does this
 * go" — and answering it here saves a walk to a terminal.
 */
function ArrivalCard({ arrival }: { readonly arrival: ExpectedArrival }) {
  const onSite = arrival.status === 'ARRIVED'

  return (
    <li>
      <Link
        href={`/receiving/new?request=${arrival.id}`}
        className={`block rounded-lg p-4 ring-1 transition-shadow hover:shadow-md sm:p-5 ${
          onSite
            ? 'bg-warning-50 ring-warning-100 dark:bg-warning-900/15 dark:ring-warning-900'
            : 'bg-[var(--surface-raised)] ring-[var(--border-subtle)]'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="numeric text-lg font-semibold">{arrival.reference}</span>
              <StatusChip status={arrival.status} />
              {arrival.isOverdue ? (
                <span className="rounded-full bg-danger-50 px-2 py-0.5 text-2xs font-semibold text-danger-700 ring-1 ring-danger-100 dark:bg-danger-900/25 dark:text-danger-100 dark:ring-danger-900">
                  Overdue
                </span>
              ) : null}
            </div>
            <p className="mt-1 truncate text-base">{arrival.customerName}</p>
          </div>

          <Quantity
            quantityKg={arrival.declaredQuantityKg}
            keshaCount={arrival.declaredKeshaCount}
            size="lg"
            layout="stacked"
            className="items-end"
          />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-2xs tracking-wide text-[var(--text-tertiary)] uppercase">
              Expected
            </dt>
            <dd>
              <OnDate value={arrival.expectedArrivalOn} />
            </dd>
          </div>
          <div>
            <dt className="text-2xs tracking-wide text-[var(--text-tertiary)] uppercase">
              Vehicle
            </dt>
            <dd className="numeric truncate">{arrival.vehiclePlate ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-2xs tracking-wide text-[var(--text-tertiary)] uppercase">
              Driver
            </dt>
            <dd className="truncate">{arrival.driverName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-2xs tracking-wide text-[var(--text-tertiary)] uppercase">
              Reserved
            </dt>
            <dd className="numeric truncate font-medium">
              {arrival.reservedLocationCode ?? (
                <span className="font-normal text-warning-900 dark:text-warning-100">
                  No space reserved
                </span>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-4 flex h-[var(--size-touch-lg)] items-center justify-center rounded-md bg-brand-700 text-base font-semibold text-white">
          {onSite ? 'Weigh and receive' : 'Start receiving'}
        </div>
      </Link>
    </li>
  )
}
