import 'server-only'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { addMinutes } from '@core/utils/date'
import { systemClock } from '@core/clock/clock'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { transitionConsignment } from '@modules/consignment'
import {
  insertJobOrder,
  transitionProcessingRequest,
  lockProcessingRequest,
} from '@modules/processing'
import { queueNotification, NOTIFICATION_TEMPLATES } from '@modules/notification'
import { findCustomer } from '@modules/customers'
import { findMachine, nextSequenceNo } from '../infrastructure/machine.repository'
import {
  insertAppointment,
  lockAppointment,
  transitionAppointment,
} from '../infrastructure/appointment.repository'

/**
 * Schedule an appointment against an APPROVED processing request.
 *
 * Creates the appointment AND its job order together — the roadmap treats these as
 * separable, but nothing in Phase 1 acts on a job order before its appointment exists, so
 * keeping them one call avoids an orphaned-job-order state a second call could fail to reach.
 *
 * Duration is estimated from the machine's rated throughput and efficiency factor — a
 * planning figure, not a ledger one, so it is computed in plain arithmetic rather than the
 * exact `Decimal` type reserved for quantities that are recorded as fact.
 */
/**
 * A blocking condition from another module's hold policy, in the shape `HoldReason` uses
 * (`@modules/dispatch/domain/clearance.ts`). Declared locally rather than imported — `dispatch`
 * and `scheduling` are both tier 5, and same-tier imports are forbidden — but TypeScript's
 * structural typing means the same `HoldReason[]` value dispatch and billing pass around is
 * assignable here without a shared import.
 */
export interface CustomerHoldReason {
  readonly code: string
  readonly message: string
  readonly overridableBy?: string | undefined
}

export interface ScheduleAppointmentInput {
  readonly processingRequestId: string
  readonly machineId: string
  readonly scheduledStartAt: Date
  readonly actorId: string
  /**
   * M19's financial hold (docs/phase-1/scope.md B3: Phase 1 shipped only document-compliance
   * and manual holds; Phase 2 adds the financial one). `scheduling` cannot import `billing`
   * (tier 6), so the caller — the app-tier action — fetches `financialHoldsFor` from
   * `@modules/billing` and passes the result in. Optional so every existing caller is
   * unaffected. No override path here yet: any hold blocks, unlike dispatch's clearance,
   * which is the fuller M17 mechanism this could grow into if scheduling needs overrides too.
   */
  readonly additionalCustomerHolds?: readonly CustomerHoldReason[]
}

type LockedRequest = Awaited<ReturnType<typeof lockProcessingRequest>>

async function notifyAppointmentScheduled(
  tx: Tx,
  request: LockedRequest,
  appointment: { id: string; reference: string },
  machineName: string,
  scheduledOn: string,
  actorId: string,
): Promise<void> {
  const customer = await findCustomer(tx, request.customerId)
  if (!customer?.primaryEmail) return

  await queueNotification(tx, {
    templateCode: NOTIFICATION_TEMPLATES.APPOINTMENT_SCHEDULED,
    recipientAddress: customer.primaryEmail,
    recipientCustomerId: request.customerId,
    variables: {
      contactName: customer.legalName,
      appointmentReference: appointment.reference,
      scheduledDate: scheduledOn,
      lineName: machineName,
      quantityKg: request.requestedQuantityKg,
    },
    sourceType: 'appointment',
    sourceId: appointment.id,
    actorId,
  })
}

async function createAppointmentAndJob(
  tx: Tx,
  request: LockedRequest,
  input: ScheduleAppointmentInput,
  machine: { name: string; ratedCapacityKgPerHour: string; efficiencyFactor: string },
): Promise<{
  appointment: { id: string; reference: string }
  jobOrderId: string
  scheduledOn: string
}> {
  const kgPerHour = Number(machine.ratedCapacityKgPerHour) * Number(machine.efficiencyFactor)
  const estimatedHours = kgPerHour > 0 ? Number(request.requestedQuantityKg) / kgPerHour : 1
  const scheduledEndAt = addMinutes(input.scheduledStartAt, Math.ceil(estimatedHours * 60))
  const scheduledOn = input.scheduledStartAt.toISOString().slice(0, 10)
  const sequenceNo = await nextSequenceNo(tx, input.machineId, scheduledOn)

  const appointment = await insertAppointment(tx, {
    branchId: request.branchId,
    customerId: request.customerId,
    consignmentId: request.consignmentId,
    machineId: input.machineId,
    scheduledOn,
    scheduledStartAt: input.scheduledStartAt,
    scheduledEndAt,
    sequenceNo,
    plannedQuantityKg: request.requestedQuantityKg,
    plannedKeshaCount: request.requestedKeshaCount,
    estimatedHours: estimatedHours.toFixed(3),
    actorId: input.actorId,
  })

  const jobOrder = await insertJobOrder(tx, {
    branchId: request.branchId,
    customerId: request.customerId,
    consignmentId: request.consignmentId,
    processingRequestId: input.processingRequestId,
    appointmentId: appointment.id,
    machineId: input.machineId,
    serviceType: request.serviceType,
    plannedInputKg: request.requestedQuantityKg,
    plannedKeshaCount: request.requestedKeshaCount,
    scheduledStartAt: input.scheduledStartAt,
    actorId: input.actorId,
  })

  return { appointment, jobOrderId: jobOrder.id, scheduledOn }
}

export async function scheduleAppointment(
  claims: DbClaims,
  input: ScheduleAppointmentInput,
): Promise<{ appointmentId: string; appointmentReference: string; jobOrderId: string }> {
  return runInTransaction(claims, async (tx) => {
    if (input.additionalCustomerHolds && input.additionalCustomerHolds.length > 0) {
      throw new BusinessRuleViolation(ERROR_CODES.VALIDATION_FAILED, {
        message: 'This customer cannot be scheduled while a financial hold is open.',
        details: { blockers: input.additionalCustomerHolds },
      })
    }

    const request = await lockProcessingRequest(tx, input.processingRequestId)
    const machine = await findMachine(tx, input.machineId)
    if (!machine) throw new Error(`Machine ${input.machineId} not found`)

    const { appointment, jobOrderId, scheduledOn } = await createAppointmentAndJob(
      tx,
      request,
      input,
      machine,
    )

    await transitionProcessingRequest(
      tx,
      input.processingRequestId,
      request.status,
      'SCHEDULED',
      input.actorId,
      { appointmentId: appointment.id },
    )
    await transitionConsignment(tx, {
      id: request.consignmentId,
      to: 'SCHEDULED',
      actorId: input.actorId,
      occurredAt: input.scheduledStartAt,
      correlationId: appointment.id,
    })

    await notifyAppointmentScheduled(
      tx,
      request,
      appointment,
      machine.name,
      scheduledOn,
      input.actorId,
    )

    return {
      appointmentId: appointment.id,
      appointmentReference: appointment.reference,
      jobOrderId,
    }
  })
}

export async function cancelAppointment(
  claims: DbClaims,
  appointmentId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const header = await lockAppointment(tx, appointmentId)
    await transitionAppointment(tx, appointmentId, header.status, 'CANCELLED', actorId, reason)
    await transitionConsignment(tx, {
      id: header.consignmentId,
      to: 'STORED',
      actorId,
      occurredAt: systemClock.now(),
      reason,
      correlationId: appointmentId,
    })
  })
}
