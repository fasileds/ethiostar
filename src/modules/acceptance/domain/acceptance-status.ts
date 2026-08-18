import { defineStateMachine, type TransitionTable } from '@core/domain/state-machine'

/** The acceptance-record lifecycle, matching the schema's check constraint. */
export const ACCEPTANCE_STATUSES = [
  'DRAFT',
  'PRESENTED',
  'ACCEPTED',
  'PARTIALLY_ACCEPTED',
  'DISPUTED',
  'CLOSED',
  'CANCELLED',
] as const

export type AcceptanceStatus = (typeof ACCEPTANCE_STATUSES)[number]

export const ACCEPTANCE_TRANSITIONS: TransitionTable<AcceptanceStatus> = {
  DRAFT: ['PRESENTED', 'CANCELLED'],
  PRESENTED: ['ACCEPTED', 'PARTIALLY_ACCEPTED', 'DISPUTED', 'CANCELLED'],
  ACCEPTED: ['CLOSED'],
  PARTIALLY_ACCEPTED: ['CLOSED', 'DISPUTED'],
  DISPUTED: ['ACCEPTED', 'PARTIALLY_ACCEPTED', 'CLOSED'],
  CLOSED: [],
  CANCELLED: [],
}

export const acceptanceStateMachine = defineStateMachine<AcceptanceStatus>(
  'acceptance_record',
  ACCEPTANCE_TRANSITIONS,
)
