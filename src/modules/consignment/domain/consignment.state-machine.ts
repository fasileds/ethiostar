import { defineStateMachine, type TransitionTable } from '@core/domain/state-machine'

/**
 * The consignment lifecycle.
 *
 * The client document states both the states and the rule:
 * "Each consignment moves through a controlled lifecycle — Requested, Accepted, Received,
 * Stored, Scheduled, In Process, Processed, Accepted by Customer, Release Requested,
 * Dispatched, Closed. The system will not permit a state to be skipped, and every
 * transition is logged with the user and timestamp."
 *
 * THIS TABLE IS ENFORCEMENT LAYER 1 OF 3:
 *   1. here, in the domain — throws InvalidStateTransition
 *   2. the repository — status is written ONLY alongside a history row
 *   3. a database trigger validating against `consignment_transition`
 *
 * The redundancy is deliberate. Layer 3 catches migrations, data-fix scripts and manual DBA
 * intervention, which is exactly when the discipline usually breaks.
 *
 * docs/architecture/03-domain-model.md §3.2
 */

export const CONSIGNMENT_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'RECEIVED',
  'STORED',
  'SCHEDULED',
  'IN_PROCESS',
  'PROCESSED',
  'ACCEPTED_BY_CUSTOMER',
  'RELEASE_REQUESTED',
  'DISPATCHED',
  'CLOSED',
  'CANCELLED',
] as const

export type ConsignmentStatus = (typeof CONSIGNMENT_STATUSES)[number]

export const CONSIGNMENT_TRANSITIONS: TransitionTable<ConsignmentStatus> = {
  /** Customer submitted a delivery request (M09/M11). */
  REQUESTED: ['ACCEPTED', 'CANCELLED'],

  /** Request approved, capacity reserved (M11 + M12). */
  ACCEPTED: ['RECEIVED', 'CANCELLED'],

  /** GRN confirmed: weights recorded and kesha counted (M11). No cancelling now —
   *  EthioStar has taken physical custody of somebody else's asset. */
  RECEIVED: ['STORED'],

  /**
   * Every lot has a room and section (M12).
   * STORED → RELEASE_REQUESTED is intentional: a customer may withdraw unprocessed coffee.
   * ⚠️ CONFIRM with EthioStar — open question 7. One row in this table, but it changes the
   * dispatch clearance rules (M16 acceptance would not have happened).
   */
  STORED: ['SCHEDULED', 'RELEASE_REQUESTED'],

  /** Appointment allocated (M14). Back to STORED if the appointment is cancelled;
   *  a reschedule stays SCHEDULED and records a delay instead. */
  SCHEDULED: ['IN_PROCESS', 'STORED'],

  /** Operator accepted and started the job (M15). */
  IN_PROCESS: ['PROCESSED'],

  /** Four outputs recorded, mass balance within tolerance or explained (M15). */
  PROCESSED: ['ACCEPTED_BY_CUSTOMER'],

  /** Mirt Merekebiya signed (M16). Ownership passes; the coffee stays in EthioStar's store. */
  ACCEPTED_BY_CUSTOMER: ['RELEASE_REQUESTED'],

  /** Customer requested release (M17). Reversible if they cancel. */
  RELEASE_REQUESTED: ['DISPATCHED', 'ACCEPTED_BY_CUSTOMER'],

  /** Gate pass used, gate-out recorded, stock deducted (M17). */
  DISPATCHED: ['CLOSED'],

  CLOSED: [],
  CANCELLED: [],
}

export const consignmentStateMachine = defineStateMachine<ConsignmentStatus>(
  'consignment',
  CONSIGNMENT_TRANSITIONS,
)

/**
 * States in which the coffee is physically in EthioStar's custody.
 * Used by ageing reports and by the dwell-time calculation.
 */
export const IN_CUSTODY_STATUSES: readonly ConsignmentStatus[] = [
  'RECEIVED',
  'STORED',
  'SCHEDULED',
  'IN_PROCESS',
  'PROCESSED',
  'ACCEPTED_BY_CUSTOMER',
  'RELEASE_REQUESTED',
]

/** States in which the consignment is finished and no longer occupies space. */
export const TERMINAL_STATUSES: readonly ConsignmentStatus[] = ['CLOSED', 'CANCELLED']

export function isInCustody(status: ConsignmentStatus): boolean {
  return IN_CUSTODY_STATUSES.includes(status)
}

export function isTerminal(status: ConsignmentStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/**
 * Lot lifecycle — separate from the consignment's, because a consignment can be PARTLY
 * processed. The consignment status is DERIVED from its lots (see deriveConsignmentStatus),
 * never set independently; otherwise the header says PROCESSED while three lots are
 * untouched.
 */
export const LOT_STATUSES = [
  'IN_STORE',
  'RESERVED_FOR_JOB',
  'CONSUMED',
  'PRODUCED',
  'ACCEPTED',
  'DISPATCHED',
] as const

export type LotStatus = (typeof LOT_STATUSES)[number]

export const LOT_TRANSITIONS: TransitionTable<LotStatus> = {
  /** Received and placed; available to be committed to a job. */
  IN_STORE: ['RESERVED_FOR_JOB', 'ACCEPTED', 'DISPATCHED'],
  /** Committed to a scheduled job; cannot be committed to a second one. */
  RESERVED_FOR_JOB: ['CONSUMED', 'IN_STORE'],
  /** Drawn into the line. Terminal: this lot no longer exists as stock — its mass is now
   *  in the output lots and the loss account. */
  CONSUMED: [],
  /** An output lot, created by a job. */
  PRODUCED: ['ACCEPTED'],
  /** Covered by a signed Mirt Merekebiya. */
  ACCEPTED: ['DISPATCHED'],
  DISPATCHED: [],
}

export const lotStateMachine = defineStateMachine<LotStatus>('lot', LOT_TRANSITIONS)

/**
 * Derive the consignment's status from its lots.
 *
 * The consignment header is a SUMMARY, never an independent fact. This is what prevents the
 * classic bug where the header reads PROCESSED while three lots are still in store.
 *
 * Rule: the consignment sits at the LEAST-advanced state any of its live lots is in.
 */
export function deriveConsignmentStatus(
  current: ConsignmentStatus,
  lotStatuses: readonly LotStatus[],
): ConsignmentStatus {
  // Before receipt there are no lots yet; the header leads.
  if (lotStatuses.length === 0) return current

  const live = lotStatuses.filter((s) => s !== 'CONSUMED')
  if (live.length === 0) return current

  if (live.every((s) => s === 'DISPATCHED')) return 'DISPATCHED'
  if (live.every((s) => s === 'ACCEPTED' || s === 'DISPATCHED')) return 'ACCEPTED_BY_CUSTOMER'
  if (live.some((s) => s === 'PRODUCED')) {
    // Outputs exist but not all are accepted — the job has run.
    return current === 'IN_PROCESS' ? 'PROCESSED' : current
  }

  return current
}
