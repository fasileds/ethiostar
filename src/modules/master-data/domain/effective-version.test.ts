import { describe, it, expect } from 'vitest'
import {
  versionAsOf,
  requireVersionAsOf,
  assertNoOverlap,
  closingDateFor,
  sortByEffectiveFrom,
  coverageGaps,
  type EffectiveDated,
} from './effective-version'
import { businessDate } from '@core/utils/date'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

const d = businessDate

interface Rate extends EffectiveDated {
  amount: string
}

const rate = (id: string, from: string, to: string | null, amount: string): Rate => ({
  id,
  effectiveFrom: d(from),
  effectiveTo: to === null ? null : d(to),
  amount,
})

/** A realistic piece-rate history: 2.00 → 2.50 → 3.00 (open-ended). */
const HISTORY: Rate[] = [
  rate('v1', '2025-01-01', '2025-06-30', '2.00'),
  rate('v2', '2025-07-01', '2026-03-31', '2.50'),
  rate('v3', '2026-04-01', null, '3.00'),
]

describe('versionAsOf — the M02 key control', () => {
  it('resolves the version in force on the given date', () => {
    expect(versionAsOf(HISTORY, d('2025-03-15'))?.amount).toBe('2.00')
    expect(versionAsOf(HISTORY, d('2025-09-01'))?.amount).toBe('2.50')
    expect(versionAsOf(HISTORY, d('2026-08-12'))?.amount).toBe('3.00')
  })

  it('resolves correctly on boundary dates (inclusive both ends)', () => {
    expect(versionAsOf(HISTORY, d('2025-06-30'))?.id).toBe('v1')
    expect(versionAsOf(HISTORY, d('2025-07-01'))?.id).toBe('v2')
    expect(versionAsOf(HISTORY, d('2026-03-31'))?.id).toBe('v2')
    expect(versionAsOf(HISTORY, d('2026-04-01'))?.id).toBe('v3')
  })

  /**
   * The control, stated as a test: a voucher raised in March 2025 must still resolve
   * 2.00 today, not the current 3.00. Changing a rate does not rewrite history.
   */
  it('does NOT retrospectively re-price a past transaction', () => {
    const whenWorkWasDone = d('2025-03-15')
    expect(versionAsOf(HISTORY, whenWorkWasDone)?.amount).toBe('2.00')
    // ...even though today's rate is different.
    expect(versionAsOf(HISTORY, d('2026-08-12'))?.amount).toBe('3.00')
  })

  it('treats a null end date as open-ended', () => {
    expect(versionAsOf(HISTORY, d('2099-01-01'))?.id).toBe('v3')
  })

  it('returns null before any version exists', () => {
    expect(versionAsOf(HISTORY, d('2024-12-31'))).toBeNull()
  })

  it('returns null for an empty history', () => {
    expect(versionAsOf([], d('2026-01-01'))).toBeNull()
  })

  it('throws when two versions overlap — the EXCLUDE constraint must have been bypassed', () => {
    const broken = [
      rate('a', '2026-01-01', '2026-12-31', '1.00'),
      rate('b', '2026-06-01', null, '2.00'),
    ]
    expect(() => versionAsOf(broken, d('2026-07-01'))).toThrow(BusinessRuleViolation)

    try {
      versionAsOf(broken, d('2026-07-01'))
      expect.unreachable()
    } catch (error) {
      expect((error as BusinessRuleViolation).code).toBe(ERROR_CODES.EFFECTIVE_PERIOD_OVERLAP)
    }
  })
})

describe('requireVersionAsOf', () => {
  it('returns the version when one exists', () => {
    expect(requireVersionAsOf(HISTORY, d('2025-03-15'), 'piece rate').amount).toBe('2.00')
  })

  it('throws a named error when none is effective', () => {
    expect(() => requireVersionAsOf(HISTORY, d('2024-01-01'), 'piece rate')).toThrow(
      /No piece rate is effective on 2024-01-01/,
    )
  })
})

describe('assertNoOverlap — mirrors the SQL EXCLUDE constraint', () => {
  it('accepts a version starting the day after the last one ends', () => {
    expect(() =>
      assertNoOverlap(HISTORY.slice(0, 2), {
        effectiveFrom: d('2026-04-01'),
        effectiveTo: null,
      }),
    ).not.toThrow()
  })

  it('rejects a version overlapping an existing closed range', () => {
    expect(() =>
      assertNoOverlap(HISTORY, {
        effectiveFrom: d('2025-03-01'),
        effectiveTo: d('2025-04-01'),
      }),
    ).toThrow(BusinessRuleViolation)
  })

  it('rejects a version overlapping an open-ended range', () => {
    expect(() =>
      assertNoOverlap(HISTORY, { effectiveFrom: d('2027-01-01'), effectiveTo: null }),
    ).toThrow(BusinessRuleViolation)
  })

  it('ignores the version being edited', () => {
    expect(() =>
      assertNoOverlap(HISTORY, {
        id: 'v2',
        effectiveFrom: d('2025-07-01'),
        effectiveTo: d('2026-03-31'),
      }),
    ).not.toThrow()
  })

  it('names the clashing versions so the UI can explain', () => {
    try {
      assertNoOverlap(HISTORY, { effectiveFrom: d('2025-01-01'), effectiveTo: null })
      expect.unreachable()
    } catch (error) {
      expect((error as BusinessRuleViolation).details?.clashingVersionIds).toEqual([
        'v1',
        'v2',
        'v3',
      ])
    }
  })
})

describe('closingDateFor — the usual way a rate changes', () => {
  it('closes the open-ended version the day before the new one starts', () => {
    expect(closingDateFor(HISTORY, d('2026-09-01'))).toEqual({
      versionId: 'v3',
      effectiveTo: d('2026-08-31'),
    })
  })

  it('handles a month boundary', () => {
    expect(closingDateFor(HISTORY, d('2026-07-01'))?.effectiveTo).toBe('2026-06-30')
  })

  it('handles a year boundary', () => {
    expect(closingDateFor(HISTORY, d('2027-01-01'))?.effectiveTo).toBe('2026-12-31')
  })

  it('returns null when there is no open-ended version to close', () => {
    expect(closingDateFor(HISTORY.slice(0, 2), d('2026-09-01'))).toBeNull()
  })
})

describe('coverageGaps — a gap means a transaction resolves nothing at all', () => {
  it('finds no gaps in a contiguous history', () => {
    expect(coverageGaps(HISTORY, d('2026-12-31'))).toEqual([])
  })

  it('detects a gap between two versions', () => {
    const gappy = [
      rate('a', '2025-01-01', '2025-06-30', '1.00'),
      rate('b', '2025-08-01', null, '2.00'),
    ]
    expect(coverageGaps(gappy, d('2026-12-31'))).toEqual([
      { from: '2025-07-01', to: '2025-08-01' },
    ])
  })

  it('detects an uncovered tail when the last version is closed', () => {
    const closed = [rate('a', '2025-01-01', '2025-06-30', '1.00')]
    expect(coverageGaps(closed, d('2025-12-31'))).toEqual([
      { from: '2025-07-01', to: '2025-12-31' },
    ])
  })

  it('reports no tail gap when the last version is open-ended', () => {
    expect(coverageGaps(HISTORY, d('2099-01-01'))).toEqual([])
  })
})

describe('sortByEffectiveFrom', () => {
  it('orders oldest first without mutating the input', () => {
    const shuffled = [HISTORY[2]!, HISTORY[0]!, HISTORY[1]!]
    expect(sortByEffectiveFrom(shuffled).map((v) => v.id)).toEqual(['v1', 'v2', 'v3'])
    expect(shuffled[0]!.id).toBe('v3')
  })
})
