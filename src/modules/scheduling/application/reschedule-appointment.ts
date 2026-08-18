import 'server-only'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { systemClock } from '@core/clock/clock'
import { queueNotification, NOTIFICATION_TEMPLATES } from '@modules/notification'
import { findCustomer } from '@modules/customers'
import { reasonCodesByCategory } from '@modules/master-data'
import { cascadeDelay, assertDelayReason, type CascadeEntry } from '../domain/delay-cascade'
import {
  lockAppointment,
  appointmentsForMachineDay,
  applyCascadeEntry,
  markAppointmentNotified,
  recordScheduleDelay,
} from '../infrastructure/appointment.repository'

/**
 * Reschedule an appointment and cascade the consequence onto everything behind it on the
 * same machine — the Stage 3 requirement, applied automatically rather than by memory.
 */
export interface RescheduleAppointmentInput {
  readonly appointmentId: string
  readonly newStartAt: Date
  readonly reasonCodeId: string
  readonly narrative: string | null
  readonly actorId: string
}

async function notifyCascade(
  tx: Tx,
  entries: readonly CascadeEntry[],
  reasonLabel: string,
  actorId: string,
): Promise<void> {
  for (const entry of entries) {
    const customer = await findCustomer(tx, entry.customerId)
    if (!customer?.primaryEmail) continue

    await queueNotification(tx, {
      templateCode: NOTIFICATION_TEMPLATES.APPOINTMENT_DELAYED,
      recipientAddress: customer.primaryEmail,
      recipientCustomerId: entry.customerId,
      variables: {
        contactName: customer.legalName,
        appointmentReference: entry.appointmentId,
        previousDate: entry.previousStartAt.toISOString().slice(0, 10),
        newDate: entry.newStartAt.toISOString().slice(0, 10),
        reason: reasonLabel,
      },
      sourceType: 'appointment',
      sourceId: entry.appointmentId,
      actorId,
    })

    await markAppointmentNotified(tx, entry.appointmentId)
  }
}

export async function rescheduleAppointment(
  claims: DbClaims,
  input: RescheduleAppointmentInput,
): Promise<{ affected: number }> {
  return runInTransaction(claims, async (tx) => {
    const reasons = await reasonCodesByCategory(tx, 'SCHEDULE_DELAY')
    const reason = reasons.find((r) => r.id === input.reasonCodeId)
    assertDelayReason(
      input.reasonCodeId,
      reason?.requiresNarrative ? input.narrative : (input.narrative ?? 'n/a'),
    )

    const header = await lockAppointment(tx, input.appointmentId)
    const day = header.scheduledStartAt.toISOString().slice(0, 10)
    const sameLine = await appointmentsForMachineDay(tx, header.machineId, day)

    const origin = {
      id: input.appointmentId,
      productionLineId: header.machineId,
      consignmentId: header.consignmentId,
      customerId: header.customerId,
      scheduledStartAt: header.scheduledStartAt,
      scheduledEndAt: header.scheduledEndAt,
      status: 'SCHEDULED' as const,
    }
    const result = cascadeDelay(origin, input.newStartAt, sameLine)

    const reasonLabel = reason?.name ?? 'Schedule change'

    for (const entry of result.entries) {
      await applyCascadeEntry(
        tx,
        entry.appointmentId,
        entry.newStartAt,
        entry.newEndAt,
        entry.delayMinutes,
        input.narrative ?? reasonLabel,
        input.actorId,
      )
    }

    await recordScheduleDelay(tx, {
      machineId: header.machineId,
      appointmentId: input.appointmentId,
      occurredOn: systemClock.now().toISOString().slice(0, 10),
      delayMinutes: result.totalDelayMinutes,
      causeCode: reason?.code ?? 'OTHER',
      description: input.narrative,
      affectedAppointments: result.entries.length,
      reportedBy: input.actorId,
    })

    await notifyCascade(tx, result.entries, reasonLabel, input.actorId)

    return { affected: result.entries.length }
  })
}
