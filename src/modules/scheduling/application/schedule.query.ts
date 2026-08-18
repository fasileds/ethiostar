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
 * M14 read models.
 *
 * The day board is the screen the client described: every machine, every booking, in order,
 * with the delay each one is carrying. It sorts by `sequence_no`, not by start time — start
 * time is the thing that MOVES when a delay lands, so ordering by it would reshuffle the
 * board under the scheduler exactly when they need it to hold still.
 */

export interface AppointmentRow {
  readonly id: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly machineId: string
  readonly machineName: string
  readonly consignmentId: string | null
  readonly consignmentReference: string | null
  readonly status: string
  readonly scheduledOn: string
  readonly scheduledStartAt: Date
  readonly scheduledEndAt: Date
  readonly sequenceNo: number
  readonly plannedQuantityKg: string
  readonly plannedKeshaCount: number | null
  readonly cumulativeDelayMinutes: number
  readonly rescheduleReason: string | null
  readonly customerNotifiedAt: Date | null
}

function toAppointment(row: Record<string, unknown>): AppointmentRow {
  return {
    id: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    machineId: col.text(row.machine_id),
    machineName: col.text(row.machine_name),
    consignmentId: col.textOrNull(row.consignment_id),
    consignmentReference: col.textOrNull(row.consignment_reference),
    status: col.text(row.status),
    scheduledOn: col.text(row.scheduled_on),
    scheduledStartAt: col.date(row.scheduled_start_at),
    scheduledEndAt: col.date(row.scheduled_end_at),
    sequenceNo: col.int(row.sequence_no),
    plannedQuantityKg: col.numeric(row.planned_quantity_kg),
    plannedKeshaCount: col.intOrNull(row.planned_kesha_count),
    cumulativeDelayMinutes: col.int(row.cumulative_delay_minutes),
    rescheduleReason: col.textOrNull(row.reschedule_reason),
    customerNotifiedAt: col.dateOrNull(row.customer_notified_at),
  }
}

const APPOINTMENT_SELECT = sql`
  select
    a.id, a.reference, a.customer_id, a.machine_id, a.consignment_id, a.status,
    a.scheduled_on, a.scheduled_start_at, a.scheduled_end_at, a.sequence_no,
    a.planned_quantity_kg, a.planned_kesha_count, a.cumulative_delay_minutes,
    a.reschedule_reason, a.customer_notified_at,
    cu.legal_name  as customer_name,
    m.name_en      as machine_name,
    cons.reference as consignment_reference
  from public.appointment a
  join public.customer cu on cu.id = a.customer_id
  join public.machine m   on m.id = a.machine_id
  left join public.consignment cons on cons.id = a.consignment_id
`

export async function listAppointments(
  tx: Tx,
  filters: {
    status?: string | undefined
    on?: string | undefined
    machineId?: string | undefined
    customerId?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<AppointmentRow>> {
  const limit = listLimit(filters.limit)

  const rows = await rawRows(
    tx,
    sql`
      ${APPOINTMENT_SELECT}
      where 1 = 1
        ${filters.status ? sql`and a.status = ${filters.status}` : sql``}
        ${filters.on ? sql`and a.scheduled_on = ${filters.on}::date` : sql``}
        ${filters.machineId ? sql`and a.machine_id = ${filters.machineId}::uuid` : sql``}
        ${filters.customerId ? sql`and a.customer_id = ${filters.customerId}::uuid` : sql``}
        ${keysetBefore(sql`a.scheduled_start_at`, sql`a.id`, filters.cursor)}
      order by a.scheduled_start_at desc, a.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(rows.map(toAppointment), limit, (row) => ({
    sortValue: cursorValue(row.scheduledStartAt),
    id: row.id,
  }))
}

export async function appointmentStatusCounts(
  tx: Tx,
  customerId?: string,
): Promise<Readonly<Record<string, number>>> {
  const rows = await rawRows(
    tx,
    sql`
      select status, count(*)::int as total
      from public.appointment
      where 1 = 1 ${customerId ? sql`and customer_id = ${customerId}::uuid` : sql``}
      group by status
    `,
  )
  return Object.fromEntries(rows.map((row) => [col.text(row.status), col.int(row.total)]))
}

export interface MachineDay {
  readonly machineId: string
  readonly machineCode: string
  readonly machineName: string
  readonly machineStatus: string
  readonly capacityKg: string | null
  readonly bookedKg: string
  readonly utilisationPct: number
  readonly isBlocked: boolean
  readonly blockedReason: string | null
  readonly appointments: readonly AppointmentRow[]
}

/**
 * The day board.
 *
 * Machines with no bookings still appear. An idle line is exactly what a scheduler needs to
 * see, and a query returning only booked machines hides the available capacity — which is
 * the one thing the screen exists to show.
 */
export async function dayBoard(tx: Tx, on: string): Promise<MachineDay[]> {
  const machines = await rawRows(
    tx,
    sql`
      select
        m.id, m.code, m.name_en, m.status,
        cd.capacity_kg, coalesce(cd.is_blocked, false) as is_blocked, cd.blocked_reason
      from public.machine m
      left join public.machine_capacity_day cd
        on cd.machine_id = m.id and cd.capacity_on = ${on}::date
      where m.is_active and m.status <> 'RETIRED'
      order by m.code
    `,
  )

  const appointments = await rawRows(
    tx,
    sql`
      ${APPOINTMENT_SELECT}
      where a.scheduled_on = ${on}::date
        and a.status not in ('CANCELLED','RESCHEDULED')
      order by a.machine_id, a.sequence_no
    `,
  )

  const byMachine = new Map<string, AppointmentRow[]>()
  for (const row of appointments) {
    const key = col.text(row.machine_id)
    const list = byMachine.get(key) ?? []
    list.push(toAppointment(row))
    byMachine.set(key, list)
  }

  return machines.map((row) => {
    const machineId = col.text(row.id)
    const booked = byMachine.get(machineId) ?? []
    const bookedKg = booked.reduce((sum, a) => sum + Number(a.plannedQuantityKg), 0)
    const capacityKg = col.numericOrNull(row.capacity_kg)

    return {
      machineId,
      machineCode: col.text(row.code),
      machineName: col.text(row.name_en),
      machineStatus: col.text(row.status),
      capacityKg,
      bookedKg: bookedKg.toFixed(3),
      utilisationPct:
        capacityKg && Number(capacityKg) > 0
          ? Math.round((bookedKg / Number(capacityKg)) * 100)
          : 0,
      isBlocked: col.bool(row.is_blocked),
      blockedReason: col.textOrNull(row.blocked_reason),
      appointments: booked,
    }
  })
}

export interface MachineRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly machineType: string
  readonly status: string
  readonly ratedCapacityKgPerHour: string
  readonly efficiencyFactor: string
  readonly nextMaintenanceOn: string | null
  readonly openAppointments: number
}

export async function listMachines(tx: Tx): Promise<MachineRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        m.id, m.code, m.name_en, m.machine_type, m.status,
        m.rated_capacity_kg_per_hour, m.efficiency_factor, m.next_maintenance_on,
        (select count(*) from public.appointment a
          where a.machine_id = m.id
            and a.status in ('REQUESTED','CONFIRMED','IN_PROGRESS'))::int as open_appointments
      from public.machine m
      where m.is_active
      order by m.code
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name_en),
    machineType: col.text(row.machine_type),
    status: col.text(row.status),
    ratedCapacityKgPerHour: col.numeric(row.rated_capacity_kg_per_hour),
    efficiencyFactor: col.numeric(row.efficiency_factor),
    nextMaintenanceOn: col.textOrNull(row.next_maintenance_on),
    openAppointments: col.int(row.open_appointments),
  }))
}

export interface DelayRow {
  readonly id: string
  readonly machineName: string
  readonly occurredOn: string
  readonly delayMinutes: number
  readonly causeCode: string
  readonly description: string | null
  readonly affectedAppointments: number
  readonly reportedByName: string | null
  readonly resolvedAt: Date | null
}

export async function recentDelays(tx: Tx, limit = 20): Promise<DelayRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        d.id, d.occurred_on, d.delay_minutes, d.cause_code, d.description,
        d.affected_appointments, d.resolved_at,
        m.name_en   as machine_name,
        u.full_name as reported_by_name
      from public.schedule_delay d
      join public.machine m on m.id = d.machine_id
      left join public.app_user u on u.id = d.reported_by
      order by d.reported_at desc
      limit ${limit}
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    machineName: col.text(row.machine_name),
    occurredOn: col.text(row.occurred_on),
    delayMinutes: col.int(row.delay_minutes),
    causeCode: col.text(row.cause_code),
    description: col.textOrNull(row.description),
    affectedAppointments: col.int(row.affected_appointments),
    reportedByName: col.textOrNull(row.reported_by_name),
    resolvedAt: col.dateOrNull(row.resolved_at),
  }))
}
