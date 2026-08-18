import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for an Appointment Confirmation (M14).
 *
 * The scheduled processing slot, as confirmed to the customer. Assembled once, at print
 * time, and stored verbatim in `printed_document.printed_snapshot` — a later reschedule must
 * not silently change what a confirmation already handed to the customer says.
 */

export interface AppointmentPrintSnapshot {
  readonly appointmentId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchName: string
  readonly consignmentReference: string | null
  readonly machineName: string
  readonly machineCode: string
  readonly scheduledOn: string
  readonly scheduledStartAt: Date
  readonly scheduledEndAt: Date
  readonly plannedQuantityKg: string
  readonly plannedKeshaCount: number | null
  readonly status: string
  readonly rescheduleReason: string | null
  readonly rescheduledFromAt: Date | null
  readonly cumulativeDelayMinutes: number
  readonly notes: string | null
}

export async function loadAppointmentPrintSnapshot(
  tx: Tx,
  appointmentId: string,
): Promise<AppointmentPrintSnapshot | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        ap.id, ap.reference, ap.customer_id, cu.legal_name as customer_name,
        br.name_en as branch_name, cons.reference as consignment_reference,
        ap.machine_id, m.name_en as machine_name, m.code as machine_code,
        ap.scheduled_on, ap.scheduled_start_at, ap.scheduled_end_at,
        ap.planned_quantity_kg, ap.planned_kesha_count, ap.status,
        ap.reschedule_reason, ap.rescheduled_from_at, ap.cumulative_delay_minutes, ap.notes
      from public.appointment ap
      join public.customer cu on cu.id = ap.customer_id
      join public.branch br on br.id = ap.branch_id
      join public.machine m on m.id = ap.machine_id
      left join public.consignment cons on cons.id = ap.consignment_id
      where ap.id = ${appointmentId}::uuid
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    appointmentId: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    branchName: col.text(row.branch_name),
    consignmentReference: col.textOrNull(row.consignment_reference),
    machineName: col.text(row.machine_name),
    machineCode: col.text(row.machine_code),
    scheduledOn: col.text(row.scheduled_on),
    scheduledStartAt: col.date(row.scheduled_start_at),
    scheduledEndAt: col.date(row.scheduled_end_at),
    plannedQuantityKg: col.numeric(row.planned_quantity_kg),
    plannedKeshaCount: col.intOrNull(row.planned_kesha_count),
    status: col.text(row.status),
    rescheduleReason: col.textOrNull(row.reschedule_reason),
    rescheduledFromAt: col.dateOrNull(row.rescheduled_from_at),
    cumulativeDelayMinutes: col.int(row.cumulative_delay_minutes),
    notes: col.textOrNull(row.notes),
  }
}
