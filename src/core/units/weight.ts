import { Decimal, type RoundingMode } from './decimal'
import { WEIGHT_DECIMAL_PLACES } from './scales'

/**
 * A weight in kilograms, exact to the gram.
 *
 * A kilogram is not a `number`. In a custody business the recorded weight is the figure a
 * commercial dispute turns on, so it is a value object with its own invariants rather than
 * a primitive that any arithmetic can quietly corrupt.
 *
 * Signed weights are permitted because the stock ledger uses signed movements
 * (see docs/architecture/03-domain-model.md §3.4). Contexts that require a non-negative
 * quantity assert it explicitly via `assertNonNegative`.
 */
export class Weight {
  private constructor(private readonly value: Decimal) {}

  static readonly SCALE = WEIGHT_DECIMAL_PLACES

  // ── Construction ──────────────────────────────────────────────────────────

  /** Parse a decimal string — the form the Postgres driver returns for `numeric`. */
  static fromKg(value: string): Weight {
    return new Weight(Decimal.parse(value, Weight.SCALE))
  }

  /** From a whole number of kilograms. */
  static fromWholeKg(value: number): Weight {
    return new Weight(Decimal.fromInteger(value, Weight.SCALE))
  }

  /** From an integer count of grams. */
  static fromGrams(grams: number | bigint): Weight {
    return new Weight(Decimal.fromUnits(grams, Weight.SCALE))
  }

  static zero(): Weight {
    return new Weight(Decimal.zero(Weight.SCALE))
  }

  /** Parse a value that must be strictly positive (a receipt line, an output). */
  static positiveFromKg(value: string, what = 'weight'): Weight {
    const w = Weight.fromKg(value)
    if (!w.isPositive()) {
      throw new RangeError(`${what} must be greater than zero, received ${w.toString()} kg`)
    }
    return w
  }

  /** Parse a value that must not be negative. */
  static nonNegativeFromKg(value: string, what = 'weight'): Weight {
    const w = Weight.fromKg(value)
    w.assertNonNegative(what)
    return w
  }

  // ── Arithmetic ────────────────────────────────────────────────────────────

  add(other: Weight): Weight {
    return new Weight(this.value.add(other.value))
  }

  subtract(other: Weight): Weight {
    return new Weight(this.value.subtract(other.value))
  }

  negate(): Weight {
    return new Weight(this.value.negate())
  }

  abs(): Weight {
    return new Weight(this.value.abs())
  }

  /** Multiply by a bag count — used for estimating from a standard net weight. */
  timesCount(count: number): Weight {
    return new Weight(this.value.multiplyByInteger(count))
  }

  /** Divide across a count, e.g. average weight per kesha. */
  perCount(count: number, mode: RoundingMode = 'HALF_UP'): Weight {
    if (count === 0) throw new RangeError('Cannot divide a weight by a zero count')
    return new Weight(this.value.divideByInteger(count, mode))
  }

  static sum(weights: readonly Weight[]): Weight {
    return weights.reduce<Weight>((acc, w) => acc.add(w), Weight.zero())
  }

  /**
   * This weight as a percentage of another — yield (output/input × 100) and
   * mass-balance variance both use this.
   */
  percentOf(total: Weight): Decimal {
    return this.value.percentOf(total.value, 3)
  }

  // ── Comparison ────────────────────────────────────────────────────────────

  compare(other: Weight): -1 | 0 | 1 {
    return this.value.compare(other.value)
  }
  equals(other: Weight): boolean {
    return this.value.equals(other.value)
  }
  lessThan(other: Weight): boolean {
    return this.value.lessThan(other.value)
  }
  lessThanOrEqual(other: Weight): boolean {
    return this.value.lessThanOrEqual(other.value)
  }
  greaterThan(other: Weight): boolean {
    return this.value.greaterThan(other.value)
  }
  greaterThanOrEqual(other: Weight): boolean {
    return this.value.greaterThanOrEqual(other.value)
  }
  isZero(): boolean {
    return this.value.isZero()
  }
  isPositive(): boolean {
    return this.value.isPositive()
  }
  isNegative(): boolean {
    return this.value.isNegative()
  }

  assertNonNegative(what = 'weight'): void {
    if (this.isNegative()) {
      throw new RangeError(`${what} must not be negative, received ${this.toString()} kg`)
    }
  }

  // ── Output ────────────────────────────────────────────────────────────────

  /** Canonical string for persistence: matches Postgres numeric(14,3). */
  toKgString(): string {
    return this.value.toString()
  }

  toString(): string {
    return this.value.toString()
  }

  toJSON(): string {
    return this.value.toString()
  }

  /** Display with a unit suffix, locale-aware. */
  format(locale = 'en-US'): string {
    return `${this.value.format(locale)} kg`
  }

  /** Escape hatch for charting only. Never for arithmetic or comparison. */
  toNumberUnsafe(): number {
    return this.value.toNumberUnsafe()
  }

  /** Underlying decimal, for callers that need percentage arithmetic. */
  get decimal(): Decimal {
    return this.value
  }
}
