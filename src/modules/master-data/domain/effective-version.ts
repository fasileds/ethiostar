import type { BusinessDate } from '@core/utils/date'
import { isWithinRange, rangesOverlap } from '@core/utils/date'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

/**
 * Effective-dated version resolution.
 *
 * M02 key control: "Master data records are versioned with effective dates; changing a
 * tariff does not retrospectively alter invoices already raised under the old rate."
 *
 * THE RULE THAT MAKES THIS WORK: a transaction stores the VERSION ID it was priced under,
 * not just the value. Re-printing a six-month-old labour voucher then reproduces the
 * original figure exactly, because it resolves the stored version rather than asking
 * "what is the rate today?".
 *
 * Applied in Phase 1 to bag-type standard weights and piece rates; Phase 2 tariffs (M10)
 * follow the identical pattern.
 */

export interface EffectiveDated {
  readonly id: string
  readonly effectiveFrom: BusinessDate
  readonly effectiveTo: BusinessDate | null
}

/**
 * The version in force on `asOf`, or null.
 *
 * `asOf` is the date of the BUSINESS EVENT — the day the labour was performed, the day the
 * coffee was received — never "today". Using today is how a rate change silently rewrites
 * history.
 */
export function versionAsOf<T extends EffectiveDated>(
  versions: readonly T[],
  asOf: BusinessDate,
): T | null {
  const matches = versions.filter((v) => isWithinRange(asOf, v.effectiveFrom, v.effectiveTo))

  if (matches.length === 0) return null

  // The database EXCLUDE constraint makes overlap impossible, so more than one match means
  // the constraint is missing or was bypassed. Fail loudly rather than picking arbitrarily.
  if (matches.length > 1) {
    throw new BusinessRuleViolation(ERROR_CODES.EFFECTIVE_PERIOD_OVERLAP, {
      message: 'More than one version is effective on the same date.',
      details: {
        asOf,
        versionIds: matches.map((m) => m.id),
      },
    })
  }

  return matches[0] ?? null
}

/** Resolve or throw — for call sites where a missing version is a hard error. */
export function requireVersionAsOf<T extends EffectiveDated>(
  versions: readonly T[],
  asOf: BusinessDate,
  subject: string,
): T {
  const version = versionAsOf(versions, asOf)
  if (!version) {
    throw new BusinessRuleViolation(ERROR_CODES.NO_EFFECTIVE_VERSION, {
      message: `No ${subject} is effective on ${asOf}.`,
      details: { asOf, subject },
    })
  }
  return version
}

/** The version in force today — for editing screens, never for pricing a past event. */
export function currentVersion<T extends EffectiveDated>(
  versions: readonly T[],
  today: BusinessDate,
): T | null {
  return versionAsOf(versions, today)
}

/**
 * Validate a proposed new version against the existing set.
 *
 * Mirrors the SQL `EXCLUDE USING gist` constraint so the UI can reject an overlap with a
 * useful message instead of surfacing a constraint violation. The database remains the
 * authority — this check races, and the constraint does not.
 */
export function assertNoOverlap<T extends EffectiveDated>(
  existing: readonly T[],
  proposed: { effectiveFrom: BusinessDate; effectiveTo: BusinessDate | null; id?: string },
): void {
  const clashes = existing.filter(
    (v) =>
      v.id !== proposed.id &&
      rangesOverlap(
        v.effectiveFrom,
        v.effectiveTo,
        proposed.effectiveFrom,
        proposed.effectiveTo,
      ),
  )

  if (clashes.length > 0) {
    throw new BusinessRuleViolation(ERROR_CODES.EFFECTIVE_PERIOD_OVERLAP, {
      message:
        'The effective period overlaps an existing version. Close the current version first.',
      details: {
        proposedFrom: proposed.effectiveFrom,
        proposedTo: proposed.effectiveTo,
        clashingVersionIds: clashes.map((c) => c.id),
      },
    })
  }
}

/**
 * The usual way a rate changes: close the open-ended current version the day before the new
 * one starts, and open a new one. Returns the closing date for the outgoing version, or
 * null when there is nothing to close.
 */
export function closingDateFor<T extends EffectiveDated>(
  existing: readonly T[],
  newEffectiveFrom: BusinessDate,
): { versionId: string; effectiveTo: BusinessDate } | null {
  const openEnded = existing.find(
    (v) => v.effectiveTo === null && v.effectiveFrom < newEffectiveFrom,
  )
  if (!openEnded) return null

  const dayBefore = new Date(Date.parse(`${newEffectiveFrom}T00:00:00.000Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10) as BusinessDate

  return { versionId: openEnded.id, effectiveTo: dayBefore }
}

/** Sorted oldest-first — the order a version history should be displayed in. */
export function sortByEffectiveFrom<T extends EffectiveDated>(versions: readonly T[]): T[] {
  return [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
}

/**
 * Gaps in coverage between the earliest version and `until`.
 *
 * A gap means a transaction on that date resolves no version at all — the failure mode is
 * silent until someone tries to price a receipt from that week.
 */
export function coverageGaps<T extends EffectiveDated>(
  versions: readonly T[],
  until: BusinessDate,
): Array<{ from: BusinessDate; to: BusinessDate }> {
  const sorted = sortByEffectiveFrom(versions)
  if (sorted.length === 0) return []

  const gaps: Array<{ from: BusinessDate; to: BusinessDate }> = []
  const dayAfter = (d: BusinessDate): BusinessDate =>
    new Date(Date.parse(`${d}T00:00:00.000Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10) as BusinessDate

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i] as T
    const next = sorted[i + 1] as T
    if (current.effectiveTo === null) break

    const expectedNextStart = dayAfter(current.effectiveTo)
    if (next.effectiveFrom > expectedNextStart) {
      gaps.push({ from: expectedNextStart, to: next.effectiveFrom })
    }
  }

  const last = sorted[sorted.length - 1] as T
  if (last.effectiveTo !== null && last.effectiveTo < until) {
    gaps.push({ from: dayAfter(last.effectiveTo), to: until })
  }

  return gaps
}
