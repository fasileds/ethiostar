import { defineStateMachine, type TransitionTable } from '@core/domain/state-machine'

/** The appointment lifecycle, matching the schema's check constraint. */
export const APPOINTMENT_STATUSES = [
  'REQUESTED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
] as const

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

export const APPOINTMENT_TRANSITIONS: TransitionTable<AppointmentStatus> = {
  REQUESTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  RESCHEDULED: [],
}

export const appointmentStateMachine = defineStateMachine<AppointmentStatus>(
  'appointment',
  APPOINTMENT_TRANSITIONS,
)
