/**
 * Generic badge — business-agnostic by design.
 *
 * `src/ui` knows nothing about coffee. A badge that renders a CONSIGNMENT status is
 * business-aware and lives in `src/modules/consignment/ui/`, which imports the tones from
 * here. That line is what keeps the design system reusable and the module UI meaningful.
 * See docs/architecture/02-project-structure.md §2.12.
 *
 * Two rules the tones exist to serve, both from the client document:
 *
 * 1. COLOUR IS NEVER THE ONLY SIGNAL. Every badge carries a label, and the tones differ in
 *    lightness as well as hue, so they survive greyscale printing (M06 prints worklists)
 *    and the common colour-vision deficiencies.
 *
 * 2. THE SCALE READS AS A JOURNEY — grey → blue → green — so a consumer can map progress
 *    onto it without reading. Amber and red sit outside that scale and mean "a human is
 *    needed", which is why they never appear as a normal step.
 */

export type Tone =
  'neutral' | 'pending' | 'active' | 'progress' | 'complete' | 'warning' | 'danger' | 'inactive'

export const TONE_CLASS: Readonly<Record<Tone, string>> = {
  neutral:
    'bg-neutral-100 text-neutral-700 ring-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700',
  pending:
    'bg-neutral-100 text-neutral-600 ring-neutral-300 dark:bg-neutral-800 dark:text-neutral-400 dark:ring-neutral-700',
  active:
    'bg-info-50 text-info-700 ring-info-100 dark:bg-info-900/25 dark:text-info-100 dark:ring-info-900',
  progress:
    'bg-coffee-100 text-coffee-800 ring-coffee-200 dark:bg-coffee-900/30 dark:text-coffee-200 dark:ring-coffee-800',
  complete:
    'bg-success-50 text-success-700 ring-success-100 dark:bg-success-900/25 dark:text-success-100 dark:ring-success-900',
  warning:
    'bg-warning-50 text-warning-900 ring-warning-100 dark:bg-warning-900/25 dark:text-warning-100 dark:ring-warning-900',
  danger:
    'bg-danger-50 text-danger-700 ring-danger-100 dark:bg-danger-900/25 dark:text-danger-100 dark:ring-danger-900',
  inactive:
    'bg-neutral-100 text-neutral-500 ring-neutral-200 line-through decoration-1 dark:bg-neutral-800/60 dark:text-neutral-500 dark:ring-neutral-700',
}

export const BADGE_SIZE = {
  sm: 'px-1.5 py-0.5 text-2xs',
  md: 'px-2 py-0.5 text-xs',
  lg: 'px-2.5 py-1 text-sm',
} as const

export type BadgeSize = keyof typeof BADGE_SIZE

export interface BadgeProps {
  readonly children: React.ReactNode
  readonly tone?: Tone
  readonly size?: BadgeSize
  readonly className?: string
  /** A leading dot makes a badge read as a status rather than a tag. */
  readonly dot?: boolean
}

export function Badge({
  children,
  tone = 'neutral',
  size = 'md',
  className = '',
  dot = false,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset whitespace-nowrap ${TONE_CLASS[tone]} ${BADGE_SIZE[size]} ${className}`}
    >
      {dot ? (
        <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      ) : null}
      {children}
    </span>
  )
}

/**
 * A generic step-progress rail.
 *
 * Takes the step and total as numbers — it does not know what the steps mean. The
 * consignment lifecycle version wraps this.
 */
export function ProgressRail({
  step,
  total,
  label,
  className = '',
  header,
}: {
  readonly step: number
  readonly total: number
  readonly label: string
  readonly className?: string
  readonly header?: React.ReactNode
}) {
  const pct = Math.round((step / total) * 100)

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        {header}
        <span className="numeric text-2xs text-[var(--text-tertiary)]">
          Step {step} of {total}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
        role="progressbar"
        aria-valuenow={step}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={label}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%`, background: 'var(--gradient-brand-subtle)' }}
        />
      </div>
    </div>
  )
}
