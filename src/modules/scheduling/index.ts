/** M14 — Appointment & Production Scheduling. */
export {
  cascadeDelay,
  assertDelayReason,
  findConflicts,
  assertNoConflict,
  describeDelay,
  type Appointment,
  type CascadeEntry,
  type CascadeResult,
} from './domain/delay-cascade'

export {
  listAppointments,
  appointmentStatusCounts,
  dayBoard,
  listMachines,
  recentDelays,
  type AppointmentRow,
  type MachineDay,
  type MachineRow,
  type DelayRow,
} from './application/schedule.query'

export {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  appointmentStateMachine,
  type AppointmentStatus,
} from './domain/appointment-status'

export {
  scheduleAppointment,
  cancelAppointment,
  type ScheduleAppointmentInput,
  type CustomerHoldReason,
} from './application/schedule-appointment'

export {
  rescheduleAppointment,
  type RescheduleAppointmentInput,
} from './application/reschedule-appointment'

export {
  loadAppointmentPrintSnapshot,
  type AppointmentPrintSnapshot,
} from './application/appointment-print-snapshot'

export {
  MACHINE_TYPES,
  MACHINE_STATUSES,
  listAllMachines,
  createMachine,
  setMachineStatus,
  type MachineAdminRow,
  type CreateMachineInput,
} from './infrastructure/machine-admin.repository'
