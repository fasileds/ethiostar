import { Badge, type Tone, type BadgeSize } from '@ui/primitives/Badge'

/**
 * Operational status labels and tones, in one place.
 *
 * Every module has its own status vocabulary and they overlap constantly — SUBMITTED,
 * APPROVED and CANCELLED mean the same thing to an operator whether they are looking at a
 * delivery request, a processing request or a release request. Defining the mapping once
 * means "amber = waiting on us" holds across the whole application, which is what lets
 * someone scan a screen they have never used before.
 *
 * The consignment lifecycle keeps its own map in @modules/consignment — it is a genuine
 * domain state machine with eleven states, not a workflow status, and it is worth the
 * separate treatment.
 */

const TONES: Readonly<Record<string, Tone>> = {
  // Not started
  DRAFT: 'pending',
  PLANNED: 'pending',
  OPEN: 'pending',
  RECORDED: 'pending',
  PENDING: 'pending',

  // Waiting on EthioStar — amber, because it is our queue
  SUBMITTED: 'warning',
  REQUESTED: 'warning',
  UNDER_REVIEW: 'warning',
  INFO_REQUESTED: 'warning',
  PRESENTED: 'warning',
  COUNTED: 'warning',
  LOADED: 'warning',
  ARRIVED: 'warning',

  // In motion
  APPROVED: 'active',
  CONFIRMED: 'active',
  SCHEDULED: 'active',
  RELEASED: 'active',
  IN_PROGRESS: 'progress',
  LOADING: 'progress',
  REVIEWED: 'active',
  SENDING: 'active',
  CALCULATED: 'active',

  // Done
  ACCEPTED: 'complete',
  PARTIALLY_ACCEPTED: 'complete',
  COMPLETED: 'complete',
  CLOSED: 'complete',
  POSTED: 'complete',
  DISPATCHED: 'complete',
  GATE_CLEARED: 'complete',
  RECEIVED: 'complete',
  PAID: 'complete',
  SENT: 'complete',
  DELIVERED: 'complete',
  ACTIVE: 'complete',
  CLEARED: 'complete',

  // Stopped, and worth noticing
  REJECTED: 'danger',
  DISPUTED: 'danger',
  BREAKDOWN: 'danger',
  FAILED: 'danger',
  BLOCKED: 'danger',
  SUSPENDED: 'danger',
  EXCEPTION: 'danger',

  // Ended without incident
  CANCELLED: 'inactive',
  WITHDRAWN: 'inactive',
  EXPIRED: 'inactive',
  RESCHEDULED: 'inactive',
  NO_SHOW: 'inactive',
  ABSENT: 'inactive',

  // Machine and mass-balance verdicts
  AVAILABLE: 'complete',
  RUNNING: 'progress',
  MAINTENANCE: 'warning',
  PAUSED: 'warning',
  BALANCED: 'complete',
  WITHIN_TOLERANCE: 'complete',
}

/** SCREAMING_SNAKE → Sentence case, so the label reads as English rather than as a constant. */
export function statusLabel(status: string): string {
  const words = status.toLowerCase().split('_')
  const [first, ...rest] = words
  if (!first) return status
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

export function statusTone(status: string): Tone {
  return TONES[status] ?? 'neutral'
}

export function StatusChip({
  status,
  size = 'sm',
}: {
  readonly status: string | null | undefined
  readonly size?: BadgeSize
}) {
  if (!status) return <span className="text-[var(--text-tertiary)]">—</span>

  return (
    <Badge tone={statusTone(status)} size={size}>
      {statusLabel(status)}
    </Badge>
  )
}
