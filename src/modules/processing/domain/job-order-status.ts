import { defineStateMachine, type TransitionTable } from '@core/domain/state-machine'

/** The job-order lifecycle, matching the schema's check constraint. */
export const JOB_ORDER_STATUSES = [
  'PLANNED',
  'RELEASED',
  'IN_PROGRESS',
  'PAUSED',
  'COMPLETED',
  'CLOSED',
  'CANCELLED',
] as const

export type JobOrderStatus = (typeof JOB_ORDER_STATUSES)[number]

export const JOB_ORDER_TRANSITIONS: TransitionTable<JobOrderStatus> = {
  PLANNED: ['RELEASED', 'CANCELLED'],
  RELEASED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['PAUSED', 'COMPLETED'],
  PAUSED: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
}

export const jobOrderStateMachine = defineStateMachine<JobOrderStatus>(
  'job_order',
  JOB_ORDER_TRANSITIONS,
)
