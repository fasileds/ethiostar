import type { Metadata } from 'next'
import Link from 'next/link'
import { pageContext, pageQuery } from '@server/page-data'
import { stockByStatus, totalInCustody, recentConsignments } from '@modules/portal'
import { listAppointments } from '@modules/scheduling'
import { listAcceptances } from '@modules/acceptance'
import { PageHeader, Card, CardHeader, StatCard, EmptyState } from '@ui/patterns/Card'
import { ButtonLink } from '@ui/primitives/Button'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { Quantity } from '@ui/patterns/Quantity'
import { StatusChip } from '@ui/patterns/StatusChip'
import { When } from '@ui/patterns/DateTime'
import { ConsignmentStatusBadge } from '@modules/consignment/ui/StatusBadge'
import type { ConsignmentStatus } from '@modules/consignment'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'My coffee' }

/**
 * The customer's home screen.
 *
 * Answers the three questions a customer actually has: how much of my coffee is here, what is
 * happening to it, and is anything waiting on me.
 *
 * Every query is scoped by `customerId` in the application AND by RLS in the database. Both,
 * deliberately — the application scoping is the primary mechanism and the policy is what
 * saves us the day someone forgets it.
 */
export default async function PortalDashboardPage() {
  const { readiness, customerId, actor } = await pageContext()

  const [custody, byStatus, consignments, appointments, acceptances] = await Promise.all([
    pageQuery({ quantityKg: '0', keshaCount: 0, lots: 0 }, (tx) =>
      totalInCustody(tx, customerId ?? undefined),
    ),
    pageQuery([], (tx) => stockByStatus(tx, customerId ?? undefined)),
    pageQuery([], (tx) => recentConsignments(tx, 6, customerId ?? undefined)),
    pageQuery({ items: [], hasMore: false, nextCursor: null }, (tx) =>
      listAppointments(tx, {
        customerId: customerId ?? undefined,
        status: 'CONFIRMED',
        limit: 5,
      }),
    ),
    pageQuery({ items: [], hasMore: false, nextCursor: null }, (tx) =>
      listAcceptances(tx, {
        customerId: customerId ?? undefined,
        status: 'PRESENTED',
        limit: 5,
      }),
    ),
  ])

  const firstName = actor?.fullName?.split(' ')[0] ?? 'there'

  return (
    <div className="space-y-7">
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Your coffee in EthioStar's custody, and anything waiting on you."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      {/* ── Waiting on the customer ───────────────────────────────────────── */}
      {acceptances.items.length > 0 ? (
        <Card className="ring-warning-100 dark:ring-warning-900">
          <CardHeader
            title="Waiting for your signature"
            description="Processed coffee is ready for you to check and accept. Nothing can be collected until it is signed."
            action={
              <Link
                href="/portal/acceptances"
                className="rounded text-sm font-medium text-[var(--text-brand)] hover:underline"
              >
                Review
              </Link>
            }
          />
          <ul className="mt-4 space-y-2">
            {acceptances.items.map((acceptance) => (
              <li
                key={acceptance.id}
                className="flex flex-wrap items-center gap-3 rounded-md bg-[var(--surface-sunken)] px-3 py-2"
              >
                <span className="numeric font-medium">{acceptance.reference}</span>
                <span className="numeric min-w-0 flex-1 truncate text-xs text-[var(--text-tertiary)]">
                  {acceptance.consignmentReference}
                </span>
                <Quantity
                  quantityKg={acceptance.presentedQuantityKg}
                  keshaCount={acceptance.presentedKeshaCount ?? 0}
                  size="sm"
                />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ── Headline figures ──────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="In EthioStar's custody"
          intent="brand"
          value={
            <Quantity
              quantityKg={custody.quantityKg}
              keshaCount={custody.keshaCount}
              size="lg"
              layout="stacked"
            />
          }
          hint={`Across ${custody.lots} lot${custody.lots === 1 ? '' : 's'}`}
          href="/portal/my-stock"
          icon={<Icon name="stock" />}
        />
        <StatCard
          label="Upcoming appointments"
          value={
            <span className="numeric text-3xl font-semibold">{appointments.items.length}</span>
          }
          hint="Confirmed processing slots"
          href="/portal/appointments"
          icon={<Icon name="calendar" />}
        />
        <StatCard
          label="Awaiting your signature"
          intent={acceptances.items.length > 0 ? 'warn' : 'neutral'}
          value={
            <span className="numeric text-3xl font-semibold">{acceptances.items.length}</span>
          }
          hint="Mirt Merekebiya"
          href="/portal/acceptances"
          icon={<Icon name="acceptance" />}
        />
      </div>

      {/* ── Stock by stage ────────────────────────────────────────────────── */}
      {byStatus.length > 0 ? (
        <Card>
          <CardHeader
            title="Where your coffee is"
            description="By stage, in kilograms and kesha."
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {byStatus.map((row) => (
              <div key={row.status} className="rounded-md bg-[var(--surface-sunken)] p-3">
                <ConsignmentStatusBadge status={row.status as ConsignmentStatus} size="sm" />
                <div className="mt-2.5">
                  <Quantity
                    quantityKg={row.quantityKg}
                    keshaCount={row.keshaCount}
                    size="md"
                    layout="stacked"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Consignments ────────────────────────────────────────────────── */}
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Your consignments"
              description="Each one follows your coffee from request to collection."
            />
          </div>
          {consignments.length === 0 ? (
            <div className="px-4 pb-5 sm:px-5">
              <EmptyState
                title="No consignments yet"
                description="Raise a delivery request to bring coffee in. Once EthioStar approves it, a consignment opens here."
                icon={<Icon name="consignments" className="size-8" />}
                action={
                  <ButtonLink href="/portal/delivery-requests" variant="primary">
                    Request a delivery
                  </ButtonLink>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {consignments.map((consignment) => (
                <li
                  key={consignment.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
                >
                  <span className="numeric shrink-0 font-medium">{consignment.reference}</span>
                  <ConsignmentStatusBadge
                    status={consignment.status as ConsignmentStatus}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1" />
                  {consignment.quantityKg ? (
                    <Quantity
                      quantityKg={consignment.quantityKg}
                      keshaCount={consignment.keshaCount ?? 0}
                      size="sm"
                    />
                  ) : (
                    <span className="text-xs text-[var(--text-tertiary)]">Not yet weighed</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Appointments ────────────────────────────────────────────────── */}
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Upcoming processing"
              description="You will be told if any of these move."
            />
          </div>
          {appointments.items.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
              No confirmed appointments.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {appointments.items.map((appointment) => (
                <li
                  key={appointment.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
                >
                  <span className="numeric shrink-0 font-medium">{appointment.reference}</span>
                  <StatusChip status={appointment.status} />
                  {appointment.cumulativeDelayMinutes > 0 ? (
                    <span className="numeric rounded bg-warning-50 px-1.5 py-0.5 text-2xs font-semibold text-warning-900 dark:bg-warning-900/25 dark:text-warning-100">
                      +{appointment.cumulativeDelayMinutes} min
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1" />
                  <When
                    value={appointment.scheduledStartAt}
                    className="shrink-0 text-xs text-[var(--text-secondary)]"
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
