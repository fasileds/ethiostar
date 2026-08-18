import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import {
  rawRows,
  col,
  listLimit,
  keysetBefore,
  toListPage,
  cursorValue,
  type ListPage,
} from '@db/helpers/list-query'

/**
 * M18 read models.
 *
 * The approval queue shows the recorded quantity next to the rate that WOULD apply, so the
 * supervisor approves a value rather than a number. Approving an unvalued row is how a
 * payroll dispute becomes unresolvable, and the database refuses it — this screen just makes
 * the refusal unnecessary.
 */

export interface WorkerRow {
  readonly id: string
  readonly workerCode: string
  readonly fullName: string
  readonly engagementType: string
  readonly crewName: string | null
  readonly defaultActivityName: string | null
  readonly phone: string | null
  readonly isActive: boolean
  readonly presentToday: boolean
}

export async function listWorkers(
  tx: Tx,
  businessDate: string,
  search?: string,
): Promise<WorkerRow[]> {
  const term = search?.trim()

  const rows = await rawRows(
    tx,
    sql`
      select
        w.id, w.worker_code, w.full_name, w.engagement_type, w.phone, w.is_active,
        c.name     as crew_name,
        at.name_en as default_activity_name,
        exists (
          select 1 from public.labour_attendance a
          where a.worker_id = w.id
            and a.attendance_on = ${businessDate}::date
            and a.status in ('PRESENT','LATE','HALF_DAY')
        ) as present_today
      from public.labour_worker w
      left join public.labour_crew_member cm on cm.worker_id = w.id and cm.left_on is null
      left join public.labour_crew c on c.id = cm.crew_id
      left join public.labour_activity_type at on at.id = w.default_activity_type_id
      where 1 = 1
        ${term ? sql`and (w.full_name ilike ${'%' + term + '%'} or w.worker_code ilike ${'%' + term + '%'})` : sql``}
      order by w.is_active desc, w.full_name
      limit 200
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    workerCode: col.text(row.worker_code),
    fullName: col.text(row.full_name),
    engagementType: col.text(row.engagement_type),
    crewName: col.textOrNull(row.crew_name),
    defaultActivityName: col.textOrNull(row.default_activity_name),
    phone: col.textOrNull(row.phone),
    isActive: col.bool(row.is_active),
    presentToday: col.bool(row.present_today),
  }))
}

export interface LabourOutputRow {
  readonly id: string
  readonly workerName: string
  readonly workerCode: string
  readonly crewName: string | null
  readonly activityName: string
  readonly jobOrderReference: string | null
  readonly producedOn: string
  readonly quantityKg: string | null
  readonly keshaCount: number | null
  readonly hoursWorked: string | null
  readonly rateBasis: string | null
  readonly rateAmount: string | null
  readonly calculatedAmount: string | null
  readonly currency: string
  readonly status: string
  readonly isDisputed: boolean
  readonly disputeNote: string | null
  readonly createdAt: Date
}

export async function listLabourOutputs(
  tx: Tx,
  filters: {
    status?: string | undefined
    on?: string | undefined
    workerId?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<LabourOutputRow>> {
  const limit = listLimit(filters.limit)

  const rows = await rawRows(
    tx,
    sql`
      select
        o.id, o.produced_on, o.quantity_kg, o.kesha_count, o.hours_worked,
        o.rate_basis, o.rate_amount, o.calculated_amount, o.currency,
        o.status, o.is_disputed, o.dispute_note, o.created_at,
        w.full_name  as worker_name,
        w.worker_code,
        c.name       as crew_name,
        at.name_en   as activity_name,
        j.reference  as job_order_reference
      from public.labour_output o
      join public.labour_worker w on w.id = o.worker_id
      join public.labour_activity_type at on at.id = o.activity_type_id
      left join public.labour_crew c on c.id = o.crew_id
      left join public.job_order j on j.id = o.job_order_id
      where 1 = 1
        ${filters.status ? sql`and o.status = ${filters.status}` : sql``}
        ${filters.on ? sql`and o.produced_on = ${filters.on}::date` : sql``}
        ${filters.workerId ? sql`and o.worker_id = ${filters.workerId}::uuid` : sql``}
        ${keysetBefore(sql`o.created_at`, sql`o.id`, filters.cursor)}
      order by o.created_at desc, o.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(
    rows.map((row): LabourOutputRow => ({
      id: col.text(row.id),
      workerName: col.text(row.worker_name),
      workerCode: col.text(row.worker_code),
      crewName: col.textOrNull(row.crew_name),
      activityName: col.text(row.activity_name),
      jobOrderReference: col.textOrNull(row.job_order_reference),
      producedOn: col.text(row.produced_on),
      quantityKg: col.numericOrNull(row.quantity_kg),
      keshaCount: col.intOrNull(row.kesha_count),
      hoursWorked: col.numericOrNull(row.hours_worked),
      rateBasis: col.textOrNull(row.rate_basis),
      rateAmount: col.numericOrNull(row.rate_amount),
      calculatedAmount: col.numericOrNull(row.calculated_amount),
      currency: col.text(row.currency ?? 'ETB'),
      status: col.text(row.status),
      isDisputed: col.bool(row.is_disputed),
      disputeNote: col.textOrNull(row.dispute_note),
      createdAt: col.date(row.created_at),
    })),
    limit,
    (row) => ({ sortValue: cursorValue(row.createdAt), id: row.id }),
  )
}

export async function labourOutputStatusCounts(
  tx: Tx,
): Promise<Readonly<Record<string, number>>> {
  const rows = await rawRows(
    tx,
    sql`select status, count(*)::int as total from public.labour_output group by status`,
  )
  return Object.fromEntries(rows.map((row) => [col.text(row.status), col.int(row.total)]))
}

export interface AttendanceRow {
  readonly id: string
  readonly workerName: string
  readonly workerCode: string
  readonly crewName: string | null
  readonly status: string
  readonly checkInAt: Date | null
  readonly checkOutAt: Date | null
  readonly hoursWorked: string | null
  readonly absenceReason: string | null
}

export async function attendanceForDay(tx: Tx, on: string): Promise<AttendanceRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        a.id, a.status, a.check_in_at, a.check_out_at, a.hours_worked, a.absence_reason,
        w.full_name as worker_name, w.worker_code,
        c.name      as crew_name
      from public.labour_attendance a
      join public.labour_worker w on w.id = a.worker_id
      left join public.labour_crew c on c.id = a.crew_id
      where a.attendance_on = ${on}::date
      order by c.name nulls last, w.full_name
      limit 300
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    workerName: col.text(row.worker_name),
    workerCode: col.text(row.worker_code),
    crewName: col.textOrNull(row.crew_name),
    status: col.text(row.status),
    checkInAt: col.dateOrNull(row.check_in_at),
    checkOutAt: col.dateOrNull(row.check_out_at),
    hoursWorked: col.numericOrNull(row.hours_worked),
    absenceReason: col.textOrNull(row.absence_reason),
  }))
}

/** Headline numbers for the labour screen. */
export async function labourDaySummary(
  tx: Tx,
  on: string,
): Promise<{
  present: number
  absent: number
  outputsRecorded: number
  outputsAwaitingApproval: number
  approvedValue: string
}> {
  const rows = await rawRows(
    tx,
    sql`
      select
        (select count(*) from public.labour_attendance
          where attendance_on = ${on}::date and status in ('PRESENT','LATE','HALF_DAY'))::int
          as present,
        (select count(*) from public.labour_attendance
          where attendance_on = ${on}::date and status = 'ABSENT')::int as absent,
        (select count(*) from public.labour_output where produced_on = ${on}::date)::int
          as outputs_recorded,
        (select count(*) from public.labour_output
          where produced_on = ${on}::date and status = 'RECORDED')::int
          as outputs_awaiting_approval,
        (select coalesce(sum(calculated_amount), 0) from public.labour_output
          where produced_on = ${on}::date and status in ('APPROVED','PAID'))
          as approved_value
    `,
  )

  const row = rows[0]
  return {
    present: row ? col.int(row.present) : 0,
    absent: row ? col.int(row.absent) : 0,
    outputsRecorded: row ? col.int(row.outputs_recorded) : 0,
    outputsAwaitingApproval: row ? col.int(row.outputs_awaiting_approval) : 0,
    approvedValue: row ? col.numeric(row.approved_value) : '0',
  }
}

export interface CrewRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly supervisorName: string | null
  readonly memberCount: number
  readonly isActive: boolean
}

export async function listCrews(tx: Tx): Promise<CrewRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        c.id, c.code, c.name, c.is_active,
        u.full_name as supervisor_name,
        (select count(*) from public.labour_crew_member m
          where m.crew_id = c.id and m.left_on is null)::int as member_count
      from public.labour_crew c
      left join public.app_user u on u.id = c.supervisor_id
      order by c.is_active desc, c.name
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name),
    supervisorName: col.textOrNull(row.supervisor_name),
    memberCount: col.int(row.member_count),
    isActive: col.bool(row.is_active),
  }))
}
