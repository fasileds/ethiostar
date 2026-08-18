import { Badge, ProgressRail, type Tone, type BadgeSize } from '@ui/primitives/Badge'
import type { ConsignmentStatus, LotStatus } from '../domain/consignment.state-machine'

/**
 * Consignment and lot status badges.
 *
 * Business-aware, so it lives HERE and not in `src/ui` — `src/ui` knows nothing about
 * coffee. It imports its tones from the design system rather than defining colours.
 * docs/architecture/02-project-structure.md §2.12
 *
 * These are the most important visual element in the system: a consignment has twelve
 * lifecycle states and an operator must read one at a glance, across a dense table, on a
 * cheap tablet in bright light.
 *
 * The tone assignment follows the JOURNEY, not the alphabet — grey → blue → coffee →
 * green as coffee moves from requested to dispatched — so "further along the scale is
 * further along the process" is learnable without reading. CANCELLED sits outside it.
 */

interface StatusMeta {
  readonly label: string
  readonly labelAm: string
  readonly tone: Tone
  /** Position in the lifecycle. Null for CANCELLED, which is off the path. */
  readonly step: number | null
  /** What happens next, for the customer portal. */
  readonly nextHint: string
}

export const CONSIGNMENT_STATUS_META: Readonly<Record<ConsignmentStatus, StatusMeta>> = {
  REQUESTED: {
    label: 'Requested',
    labelAm: 'ተጠይቋል',
    tone: 'pending',
    step: 1,
    nextHint: 'Awaiting EthioStar approval and a capacity check.',
  },
  ACCEPTED: {
    label: 'Accepted',
    labelAm: 'ተቀባይነት አግኝቷል',
    tone: 'active',
    step: 2,
    nextHint: 'Space is reserved. Deliver on the agreed date.',
  },
  RECEIVED: {
    label: 'Received',
    labelAm: 'ተረክቧል',
    tone: 'active',
    step: 3,
    nextHint: 'Weighed and counted at the gate. Being placed into store.',
  },
  STORED: {
    label: 'Stored',
    labelAm: 'ተከማችቷል',
    tone: 'active',
    step: 4,
    nextHint: 'In EthioStar custody. Request processing when ready.',
  },
  SCHEDULED: {
    label: 'Scheduled',
    labelAm: 'ተይዞለታል',
    tone: 'progress',
    step: 5,
    nextHint: 'An appointment is allocated. You will be told if the date moves.',
  },
  IN_PROCESS: {
    label: 'In process',
    labelAm: 'በሂደት ላይ',
    tone: 'progress',
    step: 6,
    nextHint: 'On the line now.',
  },
  PROCESSED: {
    label: 'Processed',
    labelAm: 'ተሰርቷል',
    tone: 'progress',
    step: 7,
    nextHint: 'Outputs recorded. Review and sign the Mirt Merekebiya.',
  },
  ACCEPTED_BY_CUSTOMER: {
    label: 'Accepted by customer',
    labelAm: 'በደንበኛ ተቀባይነት አግኝቷል',
    tone: 'complete',
    step: 8,
    nextHint: 'Yours, still held in EthioStar’s store. Request release when ready.',
  },
  RELEASE_REQUESTED: {
    label: 'Release requested',
    labelAm: 'መለቀቅ ተጠይቋል',
    tone: 'complete',
    step: 9,
    nextHint: 'Awaiting clearance and a collection slot.',
  },
  DISPATCHED: {
    label: 'Dispatched',
    labelAm: 'ተልኳል',
    tone: 'complete',
    step: 10,
    nextHint: 'Left the plant under a gate pass.',
  },
  CLOSED: {
    label: 'Closed',
    labelAm: 'ተዘግቷል',
    tone: 'neutral',
    step: 11,
    nextHint: 'Complete.',
  },
  CANCELLED: {
    label: 'Cancelled',
    labelAm: 'ተሰርዟል',
    tone: 'inactive',
    step: null,
    nextHint: 'This consignment left the lifecycle before receipt.',
  },
}

export const LOT_STATUS_META: Readonly<Record<LotStatus, { label: string; tone: Tone }>> = {
  IN_STORE: { label: 'In store', tone: 'active' },
  RESERVED_FOR_JOB: { label: 'Reserved', tone: 'progress' },
  CONSUMED: { label: 'Consumed', tone: 'inactive' },
  PRODUCED: { label: 'Produced', tone: 'progress' },
  ACCEPTED: { label: 'Accepted', tone: 'complete' },
  DISPATCHED: { label: 'Dispatched', tone: 'neutral' },
}

/** Total steps on the happy path, for the progress rail. */
export const LIFECYCLE_STEPS = 11

export function ConsignmentStatusBadge({
  status,
  size = 'md',
  locale = 'en',
}: {
  readonly status: ConsignmentStatus
  readonly size?: BadgeSize
  readonly locale?: 'en' | 'am'
}) {
  const meta = CONSIGNMENT_STATUS_META[status]
  return (
    <Badge tone={meta.tone} size={size} dot>
      <span lang={locale}>{locale === 'am' ? meta.labelAm : meta.label}</span>
    </Badge>
  )
}

export function LotStatusBadge({
  status,
  size = 'sm',
}: {
  readonly status: LotStatus
  readonly size?: BadgeSize
}) {
  const meta = LOT_STATUS_META[status]
  return (
    <Badge tone={meta.tone} size={size}>
      {meta.label}
    </Badge>
  )
}

/**
 * The lifecycle as a progress rail with a plain-language "what happens next".
 *
 * On the customer portal this is the whole point: it answers "where is my coffee and what
 * happens next" without the customer having to learn eleven state names.
 */
export function LifecycleProgress({
  status,
  locale = 'en',
  showHint = true,
  className = '',
}: {
  readonly status: ConsignmentStatus
  readonly locale?: 'en' | 'am'
  readonly showHint?: boolean
  readonly className?: string
}) {
  const meta = CONSIGNMENT_STATUS_META[status]

  if (meta.step === null) {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        <ConsignmentStatusBadge status={status} size="sm" locale={locale} />
        <span className="text-xs text-[var(--text-tertiary)]">{meta.nextHint}</span>
      </div>
    )
  }

  return (
    <div className={className}>
      <ProgressRail
        step={meta.step}
        total={LIFECYCLE_STEPS}
        label={`Lifecycle progress: ${meta.label}`}
        header={<ConsignmentStatusBadge status={status} size="sm" locale={locale} />}
      />
      {showHint ? (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">{meta.nextHint}</p>
      ) : null}
    </div>
  )
}
