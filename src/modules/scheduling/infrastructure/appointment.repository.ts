import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { appointmentStateMachine, type AppointmentStatus } from '../domain/appointment-status'
import type { Appointment as DomainAppointment } from '../domain/delay-cascade'

/**
 * Appointment writes.
 *
 * The domain's `delay-cascade.ts` speaks of a `productionLineId` and a four-value status
 * (`SCHEDULED`/`IN_PROGRESS`/`COMPLETED`/`CANCELLED`); the schema has `machineId` and the
 * seven-value lifecycle above. This file is the translation layer: CONFIRMED maps to the
 * domain's SCHEDULED (bookable, movable), everything else that is not IN_PROGRESS or
 * COMPLETED maps to CANCELLED (not movable) for the cascade's purposes.
 */

function toDomainStatus(status: AppointmentStatus): DomainAppointment['status'] {
  if (status === 'CONFIRMED' || status === 'REQUESTED') return 'SCHEDULED'
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS'
  if (status === 'COMPLETED') return 'COMPLETED'
  return 'CANCELLED'
}

export interface CreateAppointmentInput {
  readonly branchId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly machineId: string
  readonly scheduledOn: string
  readonly scheduledStartAt: Date
  readonly scheduledEndAt: Date
  readonly sequenceNo: number
  readonly plannedQuantityKg: string
  readonly plannedKeshaCount: number | null
  readonly estimatedHours: string | null
  readonly actorId: string
}

export async function insertAppointment(
  tx: Tx,
  input: CreateAppointmentInput,
): Promise<{ id: string; reference: string }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.APPOINTMENT, {
    branchId: input.branchId,
    actorId: input.actorId,
  })

  await tx.execute(sql`
    insert into public.appointment (
      id, reference, branch_id, customer_id, consignment_id, machine_id,
      scheduled_on, scheduled_start_at, scheduled_end_at, sequence_no,
      planned_quantity_kg, planned_kesha_count, estimated_hours, status, confirmed_at,
      created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.branchId}::uuid, ${input.customerId}::uuid,
      ${input.consignmentId}::uuid, ${input.machineId}::uuid,
      ${input.scheduledOn}::date, ${input.scheduledStartAt}, ${input.scheduledEndAt},
      ${input.sequenceNo},
      ${input.plannedQuantityKg}::numeric, ${input.plannedKeshaCount}, ${input.estimatedHours}::numeric,
      'CONFIRMED', now(),
      ${input.actorId}::uuid, now(), now()
    )
  `)

  return { id, reference: allocated.formatted }
}

interface AppointmentHeader {
  readonly status: AppointmentStatus
  readonly reference: string
  readonly machineId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly scheduledStartAt: Date
  readonly scheduledEndAt: Date
}

export async function lockAppointment(tx: Tx, id: string): Promise<AppointmentHeader> {
  const rows = await rawRows(
    tx,
    sql`
      select status, reference, machine_id, customer_id, consignment_id,
             scheduled_start_at, scheduled_end_at
      from public.appointment where id = ${id}::uuid for update
    `,
  )
  const row = rows[0]
  if (!row) throw new Error(`Appointment ${id} not found`)
  return {
    status: col.text(row.status) as AppointmentStatus,
    reference: col.text(row.reference),
    machineId: col.text(row.machine_id),
    customerId: col.text(row.customer_id),
    consignmentId: col.text(row.consignment_id),
    scheduledStartAt: col.date(row.scheduled_start_at),
    scheduledEndAt: col.date(row.scheduled_end_at),
  }
}

/** Same-machine appointments for one day, in the shape the cascade domain expects. */
export async function appointmentsForMachineDay(
  tx: Tx,
  machineId: string,
  scheduledOn: string,
): Promise<DomainAppointment[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, machine_id, consignment_id, customer_id, scheduled_start_at, scheduled_end_at, status
      from public.appointment
      where machine_id = ${machineId}::uuid and scheduled_on = ${scheduledOn}::date
        and status not in ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    productionLineId: col.text(row.machine_id),
    consignmentId: col.text(row.consignment_id),
    customerId: col.text(row.customer_id),
    scheduledStartAt: col.date(row.scheduled_start_at),
    scheduledEndAt: col.date(row.scheduled_end_at),
    status: toDomainStatus(col.text(row.status) as AppointmentStatus),
  }))
}

export async function transitionAppointment(
  tx: Tx,
  id: string,
  from: AppointmentStatus,
  to: AppointmentStatus,
  actorId: string,
  note?: string | null,
): Promise<void> {
  appointmentStateMachine.assert(from, to)

  await tx.execute(sql`
    update public.appointment
    set status = ${to}, updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${id}::uuid
  `)

  await tx.execute(sql`
    insert into public.appointment_status_history (
      id, appointment_id, from_status, to_status, note, changed_at, changed_by
    ) values (${uuidv7()}, ${id}::uuid, ${from}, ${to}, ${note ?? null}, now(), ${actorId}::uuid)
  `)
}

/** Apply one cascade entry's new schedule to its appointment row. */
export async function applyCascadeEntry(
  tx: Tx,
  appointmentId: string,
  newStartAt: Date,
  newEndAt: Date,
  delayMinutes: number,
  reason: string,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.appointment
    set scheduled_start_at = ${newStartAt}, scheduled_end_at = ${newEndAt},
        scheduled_on = ${newStartAt}::date,
        rescheduled_from_at = coalesce(rescheduled_from_at, scheduled_start_at),
        reschedule_reason = ${reason},
        cumulative_delay_minutes = cumulative_delay_minutes + ${delayMinutes},
        customer_notified_at = null,
        updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${appointmentId}::uuid
  `)
}

export async function markAppointmentNotified(tx: Tx, id: string): Promise<void> {
  await tx.execute(sql`
    update public.appointment set customer_notified_at = now() where id = ${id}::uuid
  `)
}

export interface RecordDelayInput {
  readonly machineId: string
  readonly appointmentId: string
  readonly occurredOn: string
  readonly delayMinutes: number
  readonly causeCode: string
  readonly description: string | null
  readonly affectedAppointments: number
  readonly reportedBy: string
}

export async function recordScheduleDelay(tx: Tx, input: RecordDelayInput): Promise<void> {
  await tx.execute(sql`
    insert into public.schedule_delay (
      id, machine_id, appointment_id, occurred_on, delay_minutes, cause_code, description,
      affected_appointments, reported_by, reported_at, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.machineId}::uuid, ${input.appointmentId}::uuid, ${input.occurredOn}::date,
      ${input.delayMinutes}, ${input.causeCode}, ${input.description},
      ${input.affectedAppointments}, ${input.reportedBy}::uuid, now(),
      ${input.reportedBy}::uuid, now(), now()
    )
  `)
}
