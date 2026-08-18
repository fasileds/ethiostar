/**
 * Business dates and times.
 *
 * THE RULE: storage is always UTC `timestamptz`. The *business day* is computed in the
 * plant's timezone. "Coffee received today" computed in UTC misfiles every receipt between
 * 21:00 and midnight local — which is the end of every working day during peak intake.
 *
 * Nothing outside this file computes a business date.
 * docs/architecture/10-risks-and-antipatterns.md D2
 */

/** Ethiopia is UTC+3 year-round; there is no daylight saving to model. */
export const BUSINESS_UTC_OFFSET_MINUTES = 180
export const BUSINESS_TIMEZONE = 'Africa/Addis_Ababa'

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000

/** An ISO calendar date with no time component: `YYYY-MM-DD`. */
export type BusinessDate = string & { readonly __brand: 'BusinessDate' }

export function businessDate(value: string): BusinessDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`Not an ISO calendar date: "${value}"`)
  }
  return value as BusinessDate
}

/** The business day an instant falls on, in the plant's timezone. */
export function toBusinessDate(instant: Date): BusinessDate {
  const shifted = new Date(instant.getTime() + BUSINESS_UTC_OFFSET_MINUTES * MS_PER_MINUTE)
  return shifted.toISOString().slice(0, 10) as BusinessDate
}

/** The UTC instant at which a business day begins (00:00 local). */
export function startOfBusinessDay(date: BusinessDate): Date {
  return new Date(
    Date.parse(`${date}T00:00:00.000Z`) - BUSINESS_UTC_OFFSET_MINUTES * MS_PER_MINUTE,
  )
}

/** The UTC instant at which a business day ends — exclusive upper bound. */
export function endOfBusinessDay(date: BusinessDate): Date {
  return new Date(startOfBusinessDay(date).getTime() + MS_PER_DAY)
}

/** Half-open UTC range `[start, end)` covering one business day. */
export function businessDayRange(date: BusinessDate): { start: Date; end: Date } {
  return { start: startOfBusinessDay(date), end: endOfBusinessDay(date) }
}

export function addBusinessDays(date: BusinessDate, days: number): BusinessDate {
  const base = Date.parse(`${date}T00:00:00.000Z`)
  return new Date(base + days * MS_PER_DAY).toISOString().slice(0, 10) as BusinessDate
}

/** Whole days between two business dates (`to − from`). */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / MS_PER_DAY,
  )
}

/**
 * Dwell time: whole days a lot has been held, from confirmed receipt to now (or to dispatch).
 * Consumed by ageing reports in Phase 1 and by M20 storage charging in Phase 2 — which is why
 * `storage_start_date` is recorded now even though nothing prices it yet.
 */
export function dwellDays(storageStart: Date, asOf: Date): number {
  return Math.max(0, daysBetween(toBusinessDate(storageStart), toBusinessDate(asOf)))
}

export function compareBusinessDates(a: BusinessDate, b: BusinessDate): -1 | 0 | 1 {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function isBusinessDateBefore(a: BusinessDate, b: BusinessDate): boolean {
  return a < b
}

export function isBusinessDateAfter(a: BusinessDate, b: BusinessDate): boolean {
  return a > b
}

/** Inclusive containment test. */
export function isWithinRange(
  date: BusinessDate,
  from: BusinessDate,
  to: BusinessDate | null,
): boolean {
  if (date < from) return false
  return to === null || date <= to
}

/** Do two closed/open date ranges overlap? Mirrors the `EXCLUDE` constraint in SQL. */
export function rangesOverlap(
  aFrom: BusinessDate,
  aTo: BusinessDate | null,
  bFrom: BusinessDate,
  bTo: BusinessDate | null,
): boolean {
  const aEnd = aTo ?? '9999-12-31'
  const bEnd = bTo ?? '9999-12-31'
  return aFrom <= bEnd && bFrom <= aEnd
}

/** ISO-8601 instant, the canonical wire form. */
export function toIsoString(instant: Date): string {
  return instant.toISOString()
}

/** Local wall-clock rendering for documents and screens. */
export function formatBusinessDateTime(instant: Date, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: BUSINESS_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(instant)
}

export function formatBusinessDate(date: BusinessDate, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    dateStyle: 'medium',
  }).format(new Date(`${date}T00:00:00.000Z`))
}

/** Minutes between two instants, rounded down — used by delay analysis. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_MINUTE)
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MS_PER_MINUTE)
}

export function addHours(instant: Date, hours: number): Date {
  return addMinutes(instant, hours * 60)
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * MS_PER_DAY)
}

/** Do two instant ranges overlap? Half-open `[start, end)`, matching `tstzrange(...,'[)')`. */
export function instantRangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd
}
