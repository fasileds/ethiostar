import type { Metadata } from 'next'
import { getActor } from '@server/auth/dal'
import { checkDatabase, queryOr } from '@server/readiness'
import { withAuthenticatedDb, ANON_CLAIMS } from '@db/client'
import {
  operationalCounts,
  totalInCustody,
  stockByStatus,
  recentConsignments,
  roomOccupancy,
  dailyIntake,
  type OperationalCounts,
  type DailyIntake,
} from '@modules/portal'
import {
  operationalDashboard,
  roleDashboard,
  type OperationalDashboardData,
  type RoleDashboardData,
} from '@modules/reporting'
import { ROLE_CODES, type RoleCode } from '@modules/identity'
import { PageHeader, StatCard, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { Quantity } from '@ui/patterns/Quantity'
import { ConsignmentStatusBadge } from '@modules/consignment/ui/StatusBadge'
import { Icon } from '@ui/layout/Icon'
import type { ConsignmentStatus } from '@modules/consignment'
import { AttentionTiles } from './_components/AttentionTiles'
import { RecentConsignments } from './_components/RecentConsignments'
import { OccupancyPanel } from './_components/OccupancyPanel'
import { IntakeTrend } from './_components/IntakeTrend'
import { ExceptionsRow } from './_components/ExceptionsRow'
import { RoleTiles } from './_components/RoleTiles'

/** Roles with a dedicated M21 dashboard view; anything else uses the tiles above only. */
const DASHBOARD_ROLES: readonly RoleCode[] = [
  ROLE_CODES.GENERAL_MANAGER,
  ROLE_CODES.FINANCE_OFFICER,
  ROLE_CODES.STORE_MANAGER,
  ROLE_CODES.PRODUCTION_OPERATOR,
]

const EMPTY_EXCEPTIONS: OperationalDashboardData['exceptionsToday'] = {
  massBalanceExceptions: 0,
  flaggedAdjustments: 0,
  overdueInvoices: 0,
}

export const metadata: Metadata = { title: 'Dashboard' }

const EMPTY_COUNTS: OperationalCounts = {
  pendingApplications: 0,
  pendingDeliveryRequests: 0,
  awaitingAcceptance: 0,
  pendingReleases: 0,
  jobsToday: 0,
  receivedToday: 0,
}

/**
 * The operations dashboard.
 *
 * Coffee received today, in process now, awaiting acceptance, awaiting dispatch, store
 * occupancy and the day's exceptions — on one screen.
 *
 * Every region degrades independently via `queryOr`, so one failing panel does not take the
 * page down, and on a machine with no database yet the whole layout still renders.
 */
export default async function StaffDashboardPage() {
  const readiness = await checkDatabase()
  const actor = await queryOr(null, getActor)

  // `status` is not optional decoration: fn_is_staff() is
  // `actor_kind = 'staff' AND status = 'ACTIVE'`, so omitting it makes every staff policy
  // deny and this whole page renders as zeroes for a fully-authorised administrator.
  const claims = actor
    ? ({
        sub: actor.userId,
        role: 'authenticated',
        actor_kind: 'staff',
        status: actor.status,
      } as const)
    : ANON_CLAIMS

  // The M21 role view: the first role the actor holds that has a dedicated dashboard.
  // A role with none (Store Keeper, Security Officer, Auditor, …) simply gets no extra
  // section — the tiles above already cover what everyone needs.
  const dashboardRole = actor?.roles.find((role) =>
    DASHBOARD_ROLES.includes(role as RoleCode),
  ) as RoleCode | undefined

  const [counts, custody, byStatus, recent, occupancy, intake, exceptions, roleTiles] =
    await Promise.all([
      queryOr(EMPTY_COUNTS, () => withAuthenticatedDb(claims, operationalCounts)),
      queryOr({ quantityKg: '0', keshaCount: 0, lots: 0 }, () =>
        withAuthenticatedDb(claims, totalInCustody),
      ),
      queryOr([], () => withAuthenticatedDb(claims, stockByStatus)),
      queryOr([], () => withAuthenticatedDb(claims, (tx) => recentConsignments(tx, 8))),
      queryOr([], () => withAuthenticatedDb(claims, roomOccupancy)),
      queryOr([] as DailyIntake[], () =>
        withAuthenticatedDb(claims, (tx) => dailyIntake(tx, 14)),
      ),
      queryOr(EMPTY_EXCEPTIONS, () =>
        withAuthenticatedDb(claims, (tx) => operationalDashboard(tx, null)).then(
          (data) => data.exceptionsToday,
        ),
      ),
      dashboardRole
        ? queryOr(null as RoleDashboardData | null, () =>
            withAuthenticatedDb(claims, (tx) => roleDashboard(tx, dashboardRole, null)),
          )
        : Promise.resolve(null as RoleDashboardData | null),
    ])

  const greeting = actor?.fullName?.split(' ')[0] ?? 'there'

  return (
    <div className="space-y-7">
      <PageHeader
        title={`Good day, ${greeting}`}
        description="Coffee received today, in process now, and everything waiting on a decision."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <AttentionTiles counts={counts} />

      <section className="grid gap-4 lg:grid-cols-3">
        <StatCard
          label="In EthioStar custody"
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
          icon={<Icon name="stock" />}
        />
        <StatCard
          label="Received today"
          value={<span className="numeric text-3xl font-semibold">{counts.receivedToday}</span>}
          secondary={<span className="text-sm text-[var(--text-secondary)]">consignments</span>}
          hint="Business day, Africa/Addis_Ababa"
          icon={<Icon name="receiving" />}
        />
        <StatCard
          label="On the line now"
          intent={counts.jobsToday > 0 ? 'success' : 'neutral'}
          value={<span className="numeric text-3xl font-semibold">{counts.jobsToday}</span>}
          secondary={
            <span className="text-sm text-[var(--text-secondary)]">
              jobs accepted or running
            </span>
          }
          href="/processing"
          icon={<Icon name="processing" />}
        />
      </section>

      <ExceptionsRow exceptions={exceptions} />

      <RoleTiles data={roleTiles} />

      {/* The trend gets the full width above the two panels. It is the only region that
          answers "is intake rising or falling", which is the question a manager opens this
          screen with — the tiles above answer "what is waiting on me right now". */}
      <IntakeTrend days={intake} />

      <div className="grid gap-5 lg:grid-cols-5">
        <RecentConsignments rows={recent} />
        <OccupancyPanel sections={occupancy} />
      </div>

      {byStatus.length > 0 ? (
        <Card>
          <CardHeader
            title="Coffee by stage"
            description="Everything currently in custody, in kilograms and kesha."
          />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                <p className="numeric mt-1.5 text-2xs text-[var(--text-tertiary)]">
                  {row.consignments} consignment{row.consignments === 1 ? '' : 's'}
                </p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
