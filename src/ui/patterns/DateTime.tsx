import {
  formatBusinessDate,
  formatBusinessDateTime,
  toBusinessDate,
  businessDate,
  BUSINESS_TIMEZONE,
} from '@core/utils/date'

/**
 * Dates, rendered in the business timezone.
 *
 * Every instant is stored in UTC and displayed in Africa/Addis_Ababa. Letting the browser
 * format it would show a store keeper in Addis one date and a reviewer abroad another for the
 * same goods receipt — and the receipt is the record that says which business day the coffee
 * arrived on.
 *
 * Rendered on the server for the same reason: a client-side conversion would produce a
 * hydration mismatch on the first paint, which is how the wrong date briefly appears.
 */

/** An instant — shows date and time. */
export function When({
  value,
  className = '',
  dateOnly = false,
}: {
  readonly value: Date | null | undefined
  readonly className?: string
  /** Drop the time when the clock component carries no meaning (a scheduled day). */
  readonly dateOnly?: boolean
}) {
  if (!value) return <span className="text-[var(--text-tertiary)]">—</span>

  const text = dateOnly
    ? formatBusinessDate(toBusinessDate(value))
    : formatBusinessDateTime(value)

  return (
    <time
      dateTime={value.toISOString()}
      title={`${text} (${BUSINESS_TIMEZONE})`}
      className={className}
    >
      {text}
    </time>
  )
}

/** A calendar date that arrived as an ISO string — no timezone conversion applies. */
export function OnDate({
  value,
  className = '',
}: {
  readonly value: string | null | undefined
  readonly className?: string
}) {
  if (!value) return <span className="text-[var(--text-tertiary)]">—</span>

  return (
    <time dateTime={value} className={className}>
      {formatBusinessDate(businessDate(value))}
    </time>
  )
}

/**
 * Elapsed time, in whole units.
 *
 * Deliberately coarse: "3 days ago" rather than "3 days 4 hours 11 minutes". The precision
 * would imply the figure is being used for something, and on these screens it never is —
 * anything needing exactness gets the timestamp.
 *
 * `now` is passed in rather than read from the clock here. Components do not get to decide
 * what time it is: the page resolves it once from the injected clock, so every "waiting 2h"
 * on one render is measured from the same instant.
 */
export function Elapsed({
  since,
  now,
}: {
  readonly since: Date | null | undefined
  readonly now: Date
}) {
  if (!since) return <span className="text-[var(--text-tertiary)]">—</span>

  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000))

  const text =
    minutes < 1
      ? 'just now'
      : minutes < 60
        ? `${minutes} min ago`
        : minutes < 60 * 24
          ? `${Math.floor(minutes / 60)} h ago`
          : `${Math.floor(minutes / (60 * 24))} d ago`

  return (
    <time dateTime={since.toISOString()} title={formatBusinessDateTime(since)}>
      {text}
    </time>
  )
}
