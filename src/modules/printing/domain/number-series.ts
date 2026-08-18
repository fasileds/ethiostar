import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

/**
 * M06 — document number formatting.
 *
 * Pure. Allocation (the row lock) lives in the repository; what a number LOOKS like is a
 * business rule and belongs here, where it can be tested without a database.
 *
 * Key control (Solution Overview §5, M06): "Every printed document carries a
 * system-generated number, a print timestamp and the name of the user who printed it."
 */

/** `GRN-2026-000045` — prefix, reset year, zero-padded value. */
export function formatDocumentNumber(
  prefix: string,
  resetYear: number,
  value: number,
  padding: number,
): string {
  if (!Number.isInteger(value) || value < 1) {
    throw new BusinessRuleViolation(ERROR_CODES.NUMBER_SERIES_NOT_FOUND, {
      message: `A document number must be a positive whole number, got ${value}.`,
    })
  }

  const digits = String(value)

  // Overflowing the padding widens the number rather than truncating it. A series that
  // reaches 1,000,000 in a year must keep issuing valid, unique numbers — silently wrapping
  // to 000000 would reissue a number that is already on paper in a customer's file.
  const body = digits.length >= padding ? digits : digits.padStart(padding, '0')

  return `${prefix}-${resetYear}-${body}`
}

export interface ParsedDocumentNumber {
  readonly prefix: string
  readonly resetYear: number
  readonly value: number
}

/**
 * Read a number back apart.
 *
 * Used by the gate and the store when somebody types a reference off a printed page, so it
 * tolerates lowercase and surrounding whitespace — the person entering it is standing at a
 * truck, not at a desk.
 */
export function parseDocumentNumber(input: string): ParsedDocumentNumber | null {
  const match = /^([A-Z]{2,8})-(\d{4})-(\d{1,12})$/.exec(input.trim().toUpperCase())
  if (!match) return null

  const [, prefix, year, value] = match
  if (!prefix || !year || !value) return null

  const parsedValue = Number(value)
  if (parsedValue < 1) return null

  return { prefix, resetYear: Number(year), value: parsedValue }
}

/**
 * The year a series should be allocating under.
 *
 * Gregorian, deliberately. Ethiopian operations reference documents by Gregorian year in
 * trade correspondence and export paperwork; the Ethiopian calendar is a DISPLAY concern
 * handled by `core/utils/date`, and mixing the two in a document identifier would make
 * "the GRN from 2018" ambiguous by seven or eight years.
 */
export function resetYearFor(now: Date): number {
  return now.getUTCFullYear()
}
