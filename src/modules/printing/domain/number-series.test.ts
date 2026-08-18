import { describe, it, expect } from 'vitest'
import { formatDocumentNumber, parseDocumentNumber, resetYearFor } from './number-series'

describe('formatDocumentNumber', () => {
  it('pads to the configured width', () => {
    expect(formatDocumentNumber('GRN', 2026, 45, 6)).toBe('GRN-2026-000045')
  })

  it('uses the value unchanged when it already fills the width', () => {
    expect(formatDocumentNumber('GP', 2026, 123456, 6)).toBe('GP-2026-123456')
  })

  /**
   * Widening rather than wrapping. A series that overflows its padding must keep issuing
   * unique numbers — wrapping to 000000 would reissue a number already printed and filed.
   */
  it('widens past the padding rather than truncating', () => {
    expect(formatDocumentNumber('GRN', 2026, 1_000_000, 6)).toBe('GRN-2026-1000000')
  })

  it('honours a narrower padding', () => {
    expect(formatDocumentNumber('LV', 2026, 7, 3)).toBe('LV-2026-007')
  })

  it('refuses a zero or negative value', () => {
    expect(() => formatDocumentNumber('GRN', 2026, 0, 6)).toThrow(/positive whole number/)
    expect(() => formatDocumentNumber('GRN', 2026, -1, 6)).toThrow(/positive whole number/)
  })

  it('refuses a non-integer value', () => {
    expect(() => formatDocumentNumber('GRN', 2026, 1.5, 6)).toThrow(/positive whole number/)
  })
})

describe('parseDocumentNumber', () => {
  it('round-trips a formatted number', () => {
    const formatted = formatDocumentNumber('MIRT', 2026, 812, 6)
    expect(parseDocumentNumber(formatted)).toEqual({
      prefix: 'MIRT',
      resetYear: 2026,
      value: 812,
    })
  })

  it('tolerates lowercase and surrounding whitespace, because it is typed at a truck', () => {
    expect(parseDocumentNumber('  gp-2026-000009 ')).toEqual({
      prefix: 'GP',
      resetYear: 2026,
      value: 9,
    })
  })

  it('returns null for anything that is not a document number', () => {
    for (const input of [
      '',
      'GRN',
      'GRN-2026',
      '2026-000045',
      'GRN-26-000045',
      'GRN-2026-abc',
    ]) {
      expect(parseDocumentNumber(input)).toBeNull()
    }
  })

  it('returns null for a zero value', () => {
    expect(parseDocumentNumber('GRN-2026-000000')).toBeNull()
  })
})

describe('resetYearFor', () => {
  it('uses the Gregorian year', () => {
    expect(resetYearFor(new Date('2026-08-14T00:00:00Z'))).toBe(2026)
  })

  it('is stable across the Ethiopian new year, which falls in September', () => {
    expect(resetYearFor(new Date('2026-09-12T00:00:00Z'))).toBe(2026)
  })
})
