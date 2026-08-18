import { defineStateMachine, type TransitionTable } from '@core/domain/state-machine'

/**
 * The application lifecycle, per the schema's own comment on `customer_application.status`:
 *
 *   DRAFT → SUBMITTED → UNDER_REVIEW → (INFO_REQUESTED ⇄ UNDER_REVIEW) → APPROVED | REJECTED
 *
 * INFO_REQUESTED can also transition directly to APPROVED or REJECTED — the staff reviewer
 * does not need to move back to UNDER_REVIEW first if the documents are already satisfactory.
 *
 * Plus WITHDRAWN, reachable by the applicant from any pre-decision state. DRAFT is not
 * reachable in Phase 1 — the public form has no resume path, so every application is
 * written straight to SUBMITTED (see `submitPublicApplication`'s own comment) — but the
 * state exists because a staff-entered application (walk-in, phone) is a plausible Phase 2
 * extension and the column already allows it.
 */
export const APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'INFO_REQUESTED',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
] as const

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

export const APPLICATION_TRANSITIONS: TransitionTable<ApplicationStatus> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['UNDER_REVIEW', 'WITHDRAWN'],
  UNDER_REVIEW: ['INFO_REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'],
  INFO_REQUESTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN'],
  APPROVED: [],
  REJECTED: [],
  WITHDRAWN: [],
}

export const applicationStateMachine = defineStateMachine<ApplicationStatus>(
  'customer_application',
  APPLICATION_TRANSITIONS,
)

export function isDecided(status: ApplicationStatus): boolean {
  return status === 'APPROVED' || status === 'REJECTED' || status === 'WITHDRAWN'
}
