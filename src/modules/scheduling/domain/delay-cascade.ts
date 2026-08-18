import { instantRangesOverlap, addMinutes, minutesBetween } from '@core/utils/date'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

/**
 * M14 — reschedule and delay cascade.
 *
 * The Stage 3 requirement, verbatim: "when a job must move — machine breakdown, overrun,
 * power interruption, customer request — the system reschedules, records the reason and
 * category of the delay, cascades the effect onto downstream jobs, and immediately notifies
 * every affected customer of their new date. This is the delay notification required in
 * Stage 3, applied automatically rather than by memory."
 *
 * "Scheduling is where EthioStar's reputation is made or lost, because a delayed slot is a
 * customer's missed shipment."
 */

export interface Appointment {
  readonly id: string
  readonly productionLineId: string
  readonly consignmentId: string
  readonly customerId: string
  readonly scheduledStartAt: Date
  readonly scheduledEndAt: Date
  readonly status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
}

export interface CascadeEntry {
  readonly appointmentId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly previousStartAt: Date
  readonly previousEndAt: Date
  readonly newStartAt: Date
  readonly newEndAt: Date
  /** How far this appointment moved. Drives the notification wording. */
  readonly delayMinutes: number
  /** True for the appointment that actually caused the delay. */
  readonly isOrigin: boolean
}

export interface CascadeResult {
  readonly entries: readonly CascadeEntry[]
  /** Every customer who must be told — the Stage 3 notification list. */
  readonly affectedCustomerIds: readonly string[]
  readonly totalDelayMinutes: number
}

/**
 * Push an appointment out and cascade the consequence onto everything downstream on the
 * same production line.
 *
 * The cascade is the point. Moving one job by three hours without moving the jobs behind it
 * produces a schedule that silently double-books, and the customers behind it are told
 * nothing — which is exactly the failure the Stage 3 requirement describes.
 *
 * Only SCHEDULED appointments on the SAME line move. A job already IN_PROGRESS is not
 * touched: it is physically running.
 */
export function cascadeDelay(
  origin: Appointment,
  newStartAt: Date,
  sameLineAppointments: readonly Appointment[],
): CascadeResult {
  if (origin.status !== 'SCHEDULED') {
    throw new BusinessRuleViolation(ERROR_CODES.ENTITY_NOT_IN_EXPECTED_STATE, {
      message: 'Only a scheduled appointment can be rescheduled.',
      details: { appointmentId: origin.id, status: origin.status },
    })
  }

  const durationMinutes = minutesBetween(origin.scheduledStartAt, origin.scheduledEndAt)
  const shiftMinutes = minutesBetween(origin.scheduledStartAt, newStartAt)

  if (shiftMinutes === 0) {
    return { entries: [], affectedCustomerIds: [], totalDelayMinutes: 0 }
  }

  const newEndAt = addMinutes(newStartAt, durationMinutes)

  const entries: CascadeEntry[] = [
    {
      appointmentId: origin.id,
      customerId: origin.customerId,
      consignmentId: origin.consignmentId,
      previousStartAt: origin.scheduledStartAt,
      previousEndAt: origin.scheduledEndAt,
      newStartAt,
      newEndAt,
      delayMinutes: shiftMinutes,
      isOrigin: true,
    },
  ]

  entries.push(...pushDownstream(origin, newEndAt, sameLineAppointments))

  return {
    entries,
    affectedCustomerIds: [...new Set(entries.map((e) => e.customerId))],
    totalDelayMinutes: shiftMinutes,
  }
}

/**
 * Push the jobs behind the moved one, in schedule order.
 *
 * A job that still fits after the moved one does NOT move — a gap in the schedule absorbs
 * part of the delay, and telling a customer their slot moved when it did not is its own
 * kind of failure.
 */
function pushDownstream(
  origin: Appointment,
  originNewEndAt: Date,
  sameLineAppointments: readonly Appointment[],
): CascadeEntry[] {
  const downstream = sameLineAppointments
    .filter(
      (a) =>
        a.id !== origin.id &&
        a.status === 'SCHEDULED' &&
        a.productionLineId === origin.productionLineId &&
        a.scheduledStartAt >= origin.scheduledStartAt,
    )
    .sort((a, b) => a.scheduledStartAt.getTime() - b.scheduledStartAt.getTime())

  const entries: CascadeEntry[] = []
  let previousEnd = originNewEndAt

  for (const appointment of downstream) {
    if (appointment.scheduledStartAt >= previousEnd) {
      previousEnd = appointment.scheduledEndAt
      continue
    }

    const jobDuration = minutesBetween(appointment.scheduledStartAt, appointment.scheduledEndAt)
    const pushedStart = previousEnd
    const pushedEnd = addMinutes(pushedStart, jobDuration)

    entries.push({
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      consignmentId: appointment.consignmentId,
      previousStartAt: appointment.scheduledStartAt,
      previousEndAt: appointment.scheduledEndAt,
      newStartAt: pushedStart,
      newEndAt: pushedEnd,
      delayMinutes: minutesBetween(appointment.scheduledStartAt, pushedStart),
      isOrigin: false,
    })

    previousEnd = pushedEnd
  }

  return entries
}

/**
 * A reschedule MUST carry a reason and a category.
 *
 * "records the reason and category of the delay" — without it the delay-analysis-by-cause
 * report in the client document's §7.2 cannot be produced, and management cannot tell
 * machine breakdowns from customer requests.
 */
export function assertDelayReason(reasonCodeId: string | null, narrative: string | null): void {
  if (!reasonCodeId) {
    throw new BusinessRuleViolation(ERROR_CODES.DELAY_REASON_REQUIRED, {
      message: 'A reschedule must record why the appointment moved.',
    })
  }

  // "Other" and similar codes carry requires_narrative; the caller resolves that flag and
  // passes narrative accordingly. An empty string is treated as absent.
  if (narrative !== null && narrative.trim().length === 0) {
    throw new BusinessRuleViolation(ERROR_CODES.DELAY_REASON_REQUIRED, {
      message: 'This delay reason requires a written explanation.',
    })
  }
}

/**
 * Would this booking collide with an existing one on the same line?
 *
 * Mirrors the `EXCLUDE USING gist` constraint on `appointment`. The database is the
 * authority — this check races and the constraint does not — but checking here lets the UI
 * refuse with a useful message instead of surfacing a constraint violation.
 */
export function findConflicts(
  candidate: { productionLineId: string; startAt: Date; endAt: Date; excludeId?: string },
  existing: readonly Appointment[],
): Appointment[] {
  return existing.filter(
    (a) =>
      a.id !== candidate.excludeId &&
      a.productionLineId === candidate.productionLineId &&
      (a.status === 'SCHEDULED' || a.status === 'IN_PROGRESS') &&
      instantRangesOverlap(
        a.scheduledStartAt,
        a.scheduledEndAt,
        candidate.startAt,
        candidate.endAt,
      ),
  )
}

export function assertNoConflict(
  candidate: { productionLineId: string; startAt: Date; endAt: Date; excludeId?: string },
  existing: readonly Appointment[],
): void {
  const conflicts = findConflicts(candidate, existing)
  if (conflicts.length > 0) {
    throw new BusinessRuleViolation(ERROR_CODES.APPOINTMENT_OVERLAP, {
      message: 'That slot overlaps an existing appointment on this production line.',
      details: {
        productionLineId: candidate.productionLineId,
        conflictingAppointmentIds: conflicts.map((c) => c.id),
      },
    })
  }
}

/** Human wording for the delay notification. */
export function describeDelay(entry: CascadeEntry): string {
  const hours = Math.floor(Math.abs(entry.delayMinutes) / 60)
  const minutes = Math.abs(entry.delayMinutes) % 60

  const magnitude =
    hours > 0
      ? `${hours} hour${hours === 1 ? '' : 's'}${minutes > 0 ? ` ${minutes} minutes` : ''}`
      : `${minutes} minutes`

  return entry.delayMinutes > 0
    ? `Moved later by ${magnitude}`
    : `Brought forward by ${magnitude}`
}
