import type { Metadata } from 'next'
import { pageContext, pageQuery, firstParam, emptyListPage } from '@server/page-data'
import {
  labourDaySummary,
  attendanceForDay,
  listLabourOutputs,
  listCrews,
  type AttendanceRow,
  type LabourOutputRow,
  type CrewRow,
} from '@modules/labour'
import { PageHeader, Card, CardHeader, StatCard, EmptyState } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { StatusChip } from '@ui/patterns/StatusChip'
import { OnDate, When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'
import { systemClock } from '@core/clock/clock'
import { toBusinessDate } from '@core/utils/date'

export const metadata: Metadata = { title: 'Labour' }

/**
 * M18 — the labour day.
 *
 * The approval queue shows each recorded output next to the money it is worth. A supervisor
 * approves a VALUE, not a number — the database refuses to approve an unvalued row, and this
 * screen is what makes that refusal unnecessary rather than annoying.
 */
export default async function LabourPage(props: PageProps<'/labour'>) {
  const search = await props.searchParams
  const { readiness } = await pageContext()

  const today = toBusinessDate(systemClock.now())
  const on = firstParam(search, 'on') ?? today
  const now = systemClock.now()

  const [summary, attendance, pending, crews] = await Promise.all([
    pageQuery(
      {
        present: 0,
        absent: 0,
        outputsRecorded: 0,
        outputsAwaitingApproval: 0,
        approvedValue: '0',
      },
      (tx) => labourDaySummary(tx, on),
    ),
    pageQuery([] as AttendanceRow[], (tx) => attendanceForDay(tx, on)),
    pageQuery(emptyListPage<LabourOutputRow>(), (tx) =>
      listLabourOutputs(tx, { status: 'RECORDED', on, limit: 25 }),
    ),
    pageQuery([] as CrewRow[], listCrews),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Labour"
        description="Attendance, piece-rate output and the approval that turns it into pay."
        meta={<OnDate value={on} className="text-sm text-[var(--text-secondary)]" />}
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Present"
          intent="success"
          value={<span className="numeric text-3xl font-semibold">{summary.present}</span>}
          hint={`${summary.absent} absent`}
          icon={<Icon name="labour" />}
        />
        <StatCard
          label="Outputs recorded"
          value={
            <span className="numeric text-3xl font-semibold">{summary.outputsRecorded}</span>
          }
          hint="Today"
          icon={<Icon name="processing" />}
        />
        <StatCard
          label="Awaiting approval"
          intent={summary.outputsAwaitingApproval > 0 ? 'warn' : 'neutral'}
          value={
            <span className="numeric text-3xl font-semibold">
              {summary.outputsAwaitingApproval}
            </span>
          }
          hint="Unvalued until approved"
          icon={<Icon name="acceptance" />}
        />
        <StatCard
          label="Approved value"
          intent="brand"
          value={
            <span className="numeric text-2xl font-semibold">
              {summary.approvedValue}
              <span className="ml-1 text-sm font-normal opacity-60">ETB</span>
            </span>
          }
          hint="Today, approved or paid"
          icon={<Icon name="labour" />}
        />
      </div>

      {/* ── Approval queue ────────────────────────────────────────────────── */}
      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Output awaiting approval"
            description="The rate shown is the one in force on the production date; approving copies it onto the row."
          />
        </div>

        {pending.items.length === 0 ? (
          <div className="px-4 pb-5 sm:px-5">
            <EmptyState
              title="Nothing awaiting approval"
              description="Recorded output appears here until a supervisor approves it. Approved rows carry the rate they were valued at."
              icon={<Icon name="labour" className="size-8" />}
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {pending.items.map((output) => (
              <li
                key={output.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{output.workerName}</span>
                    <span className="numeric text-xs text-[var(--text-tertiary)]">
                      {output.workerCode}
                    </span>
                    {output.isDisputed ? (
                      <span
                        className="rounded bg-danger-50 px-1.5 py-0.5 text-2xs font-semibold text-danger-700 dark:bg-danger-900/25 dark:text-danger-100"
                        title={output.disputeNote ?? 'Supervisor count differs from the claim'}
                      >
                        Disputed
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                    {output.activityName}
                    {output.crewName ? ` · ${output.crewName}` : ''}
                    {output.jobOrderReference ? ` · ${output.jobOrderReference}` : ''}
                  </p>
                </div>

                <span className="numeric shrink-0 text-sm">
                  {output.quantityKg ? `${output.quantityKg} kg` : null}
                  {output.keshaCount ? ` ${output.keshaCount} kesha` : null}
                  {output.hoursWorked ? ` ${output.hoursWorked} h` : null}
                </span>

                <span className="numeric shrink-0 text-sm font-semibold">
                  {output.calculatedAmount ? (
                    <>
                      {output.calculatedAmount}
                      <span className="ml-0.5 font-normal opacity-55">{output.currency}</span>
                    </>
                  ) : (
                    <span className="text-xs font-normal text-warning-900 dark:text-warning-100">
                      No rate found
                    </span>
                  )}
                </span>

                <StatusChip status={output.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Attendance ──────────────────────────────────────────────────── */}
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader title="Attendance" description="One row per worker per shift." />
          </div>
          {attendance.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
              No attendance recorded for this day.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {attendance.slice(0, 20).map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {row.workerName}
                    {row.crewName ? (
                      <span className="text-[var(--text-tertiary)]"> · {row.crewName}</span>
                    ) : null}
                  </span>
                  {row.checkInAt ? (
                    <When
                      value={row.checkInAt}
                      className="shrink-0 text-xs text-[var(--text-tertiary)]"
                    />
                  ) : null}
                  <StatusChip status={row.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Crews ───────────────────────────────────────────────────────── */}
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Crews"
              description="A worker belongs to one crew at a time, so output attribution is never ambiguous."
            />
          </div>
          {crews.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
              No crews configured.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {crews.map((crew) => (
                <li key={crew.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span className="numeric shrink-0 text-xs text-[var(--text-tertiary)]">
                    {crew.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {crew.name}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--text-secondary)]">
                    {crew.supervisorName ?? 'No supervisor'}
                  </span>
                  <span className="numeric shrink-0 text-xs text-[var(--text-tertiary)]">
                    {crew.memberCount} members
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="text-xs text-[var(--text-tertiary)]">
        Rendered at <When value={now} />.
      </p>
    </div>
  )
}
