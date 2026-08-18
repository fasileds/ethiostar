import { describe, it, expect } from 'vitest'
import {
  toBusinessDate,
  businessDate,
  startOfBusinessDay,
  endOfBusinessDay,
  businessDayRange,
  addBusinessDays,
  daysBetween,
  dwellDays,
  rangesOverlap,
  isWithinRange,
  instantRangesOverlap,
  minutesBetween,
  BUSINESS_UTC_OFFSET_MINUTES,
} from './date'

describe('business day boundary (Africa/Addis_Ababa, UTC+3)', () => {
  it('is UTC+3 with no daylight saving', () => {
    expect(BUSINESS_UTC_OFFSET_MINUTES).toBe(180)
  })

  it('files a late-evening receipt on the correct business day', () => {
    // 21:30 UTC on the 12th is 00:30 local on the 13th — the trap this module exists for.
    expect(toBusinessDate(new Date('2026-08-12T21:30:00Z'))).toBe('2026-08-13')
    // 20:30 UTC is 23:30 local, still the 12th.
    expect(toBusinessDate(new Date('2026-08-12T20:30:00Z'))).toBe('2026-08-12')
  })

  it('files an early-morning receipt correctly', () => {
    // 05:00 local on the 12th is 02:00 UTC.
    expect(toBusinessDate(new Date('2026-08-12T02:00:00Z'))).toBe('2026-08-12')
  })

  it('computes the UTC window covering a business day', () => {
    const { start, end } = businessDayRange(businessDate('2026-08-12'))
    expect(start.toISOString()).toBe('2026-08-11T21:00:00.000Z')
    expect(end.toISOString()).toBe('2026-08-12T21:00:00.000Z')
  })

  it('start and end are consistent with toBusinessDate', () => {
    const d = businessDate('2026-08-12')
    const start = startOfBusinessDay(d)
    const justBeforeEnd = new Date(endOfBusinessDay(d).getTime() - 1)
    expect(toBusinessDate(start)).toBe(d)
    expect(toBusinessDate(justBeforeEnd)).toBe(d)
    expect(toBusinessDate(endOfBusinessDay(d))).toBe('2026-08-13')
  })

  it('rejects a malformed date', () => {
    expect(() => businessDate('12/08/2026')).toThrow()
    expect(() => businessDate('2026-8-12')).toThrow()
  })
})

describe('date arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addBusinessDays(businessDate('2026-08-30'), 3)).toBe('2026-09-02')
  })

  it('adds days across a year boundary', () => {
    expect(addBusinessDays(businessDate('2026-12-30'), 3)).toBe('2027-01-02')
  })

  it('handles a leap day', () => {
    expect(addBusinessDays(businessDate('2028-02-28'), 1)).toBe('2028-02-29')
    expect(addBusinessDays(businessDate('2028-02-28'), 2)).toBe('2028-03-01')
  })

  it('counts days between dates', () => {
    expect(daysBetween(businessDate('2026-08-01'), businessDate('2026-08-31'))).toBe(30)
    expect(daysBetween(businessDate('2026-08-31'), businessDate('2026-08-01'))).toBe(-30)
  })

  it('counts minutes between instants', () => {
    expect(
      minutesBetween(new Date('2026-08-12T09:00:00Z'), new Date('2026-08-12T11:30:00Z')),
    ).toBe(150)
  })
})

describe('dwellDays — ageing stock, and M20 storage charging in Phase 2', () => {
  it('counts whole days held', () => {
    expect(dwellDays(new Date('2026-07-01T08:00:00Z'), new Date('2026-08-12T08:00:00Z'))).toBe(
      42,
    )
  })

  it('is zero on the day of receipt', () => {
    expect(dwellDays(new Date('2026-08-12T06:00:00Z'), new Date('2026-08-12T18:00:00Z'))).toBe(
      0,
    )
  })

  it('never goes negative if clocks disagree', () => {
    expect(dwellDays(new Date('2026-08-12T08:00:00Z'), new Date('2026-08-10T08:00:00Z'))).toBe(
      0,
    )
  })

  it('uses the business day, not the UTC day', () => {
    // Received 21:30 UTC on the 11th = 00:30 local on the 12th.
    // As of 08:00 UTC on the 12th = 11:00 local on the 12th. Same business day → 0.
    expect(dwellDays(new Date('2026-08-11T21:30:00Z'), new Date('2026-08-12T08:00:00Z'))).toBe(
      0,
    )
  })
})

describe('effective-date ranges (mirrors the SQL EXCLUDE constraint)', () => {
  const d = businessDate

  it('detects overlapping closed ranges', () => {
    expect(
      rangesOverlap(d('2026-01-01'), d('2026-06-30'), d('2026-06-01'), d('2026-12-31')),
    ).toBe(true)
  })

  it('accepts adjacent non-overlapping ranges', () => {
    expect(
      rangesOverlap(d('2026-01-01'), d('2026-05-31'), d('2026-06-01'), d('2026-12-31')),
    ).toBe(false)
  })

  it('treats a null end as open-ended', () => {
    expect(rangesOverlap(d('2026-01-01'), null, d('2030-01-01'), null)).toBe(true)
    expect(rangesOverlap(d('2026-01-01'), d('2026-12-31'), d('2027-01-01'), null)).toBe(false)
  })

  it('selects the version live on a given date', () => {
    expect(isWithinRange(d('2026-03-15'), d('2026-01-01'), d('2026-06-30'))).toBe(true)
    expect(isWithinRange(d('2026-07-15'), d('2026-01-01'), d('2026-06-30'))).toBe(false)
    expect(isWithinRange(d('2030-07-15'), d('2026-01-01'), null)).toBe(true)
  })
})

describe('instant ranges (mirrors the appointment EXCLUDE constraint)', () => {
  const t = (s: string) => new Date(s)

  it('detects an overlapping booking on one line', () => {
    expect(
      instantRangesOverlap(
        t('2026-08-12T08:00:00Z'),
        t('2026-08-12T12:00:00Z'),
        t('2026-08-12T11:00:00Z'),
        t('2026-08-12T15:00:00Z'),
      ),
    ).toBe(true)
  })

  it('permits back-to-back slots (half-open range)', () => {
    expect(
      instantRangesOverlap(
        t('2026-08-12T08:00:00Z'),
        t('2026-08-12T12:00:00Z'),
        t('2026-08-12T12:00:00Z'),
        t('2026-08-12T16:00:00Z'),
      ),
    ).toBe(false)
  })

  it('detects full containment', () => {
    expect(
      instantRangesOverlap(
        t('2026-08-12T08:00:00Z'),
        t('2026-08-12T18:00:00Z'),
        t('2026-08-12T10:00:00Z'),
        t('2026-08-12T11:00:00Z'),
      ),
    ).toBe(true)
  })
})
