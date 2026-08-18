/**
 * Exact decimal arithmetic backed by bigint.
 *
 * WHY THIS EXISTS: `0.1 + 0.2 !== 0.3`. In a custody business, a floating-point rounding
 * error becomes a mass-balance variance nobody can explain, in a report whose entire purpose
 * is being explainable. Every business quantity — weight, money, percentage — goes through
 * this type. The Postgres driver returns `numeric` as a *string* and it is parsed here,
 * never into a JS `number`.
 *
 * Representation: an integer `units` scaled by 10^`scale`.
 *   Decimal("12.345", scale 3) → units = 12345n
 */

export class DecimalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecimalError'
  }
}

const POW10: bigint[] = Array.from({ length: 19 }, (_, i) => 10n ** BigInt(i))

function pow10(n: number): bigint {
  if (n < 0) throw new DecimalError(`Negative scale: ${n}`)
  return POW10[n] ?? 10n ** BigInt(n)
}

/** Rounding mode. HALF_UP matches how a person rounds an invoice by hand. */
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN'

export class Decimal {
  private constructor(
    readonly units: bigint,
    readonly scale: number,
  ) {}

  // ── Construction ──────────────────────────────────────────────────────────

  /**
   * The primary constructor. Accepts a decimal string (the form the pg driver returns).
   * Rejects anything that is not an exact decimal literal — including `Infinity`, `NaN`
   * and exponent notation, all of which indicate a float leaked in somewhere.
   */
  static parse(value: string, scale: number): Decimal {
    const trimmed = value.trim()
    if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      throw new DecimalError(`Not an exact decimal literal: "${value}"`)
    }

    const negative = trimmed.startsWith('-')
    const unsigned = trimmed.replace(/^[+-]/, '')
    const [intPart = '0', fracPart = ''] = unsigned.split('.')

    // Reject silent precision loss rather than truncating a weight behind the user's back.
    if (fracPart.length > scale) {
      const significant = fracPart.slice(scale).replace(/0+$/, '')
      if (significant.length > 0) {
        throw new DecimalError(
          `"${value}" has more precision than scale ${scale} allows. ` +
            `Round explicitly if that is intended.`,
        )
      }
    }

    const padded = fracPart.padEnd(scale, '0').slice(0, scale)
    const units = BigInt(intPart + padded)
    return new Decimal(negative ? -units : units, scale)
  }

  /** Construct from an integer count of the smallest unit (grams, cents). */
  static fromUnits(units: bigint | number, scale: number): Decimal {
    const asBig = typeof units === 'number' ? BigInt(Math.trunc(units)) : units
    if (typeof units === 'number' && !Number.isInteger(units)) {
      throw new DecimalError(`fromUnits requires an integer, received ${units}`)
    }
    return new Decimal(asBig, scale)
  }

  /**
   * Construct from a JS number. DELIBERATELY NARROW: only integers are accepted, because a
   * fractional `number` may already have lost precision before it reached us. Use `parse`.
   */
  static fromInteger(value: number, scale: number): Decimal {
    if (!Number.isInteger(value)) {
      throw new DecimalError(
        `fromInteger received a non-integer (${value}). Use Decimal.parse("${value}", ${scale}) ` +
          `to avoid float precision loss.`,
      )
    }
    return new Decimal(BigInt(value) * pow10(scale), scale)
  }

  static zero(scale: number): Decimal {
    return new Decimal(0n, scale)
  }

  // ── Scale ─────────────────────────────────────────────────────────────────

  private assertSameScale(other: Decimal, op: string): void {
    if (other.scale !== this.scale) {
      throw new DecimalError(
        `Cannot ${op} decimals of different scale (${this.scale} vs ${other.scale}). ` +
          `Rescale explicitly.`,
      )
    }
  }

  /** Change scale. Widening is exact; narrowing rounds by the given mode. */
  rescale(newScale: number, mode: RoundingMode = 'HALF_UP'): Decimal {
    if (newScale === this.scale) return this
    if (newScale > this.scale) {
      return new Decimal(this.units * pow10(newScale - this.scale), newScale)
    }
    const divisor = pow10(this.scale - newScale)
    return new Decimal(divideRounded(this.units, divisor, mode), newScale)
  }

  // ── Arithmetic ────────────────────────────────────────────────────────────

  add(other: Decimal): Decimal {
    this.assertSameScale(other, 'add')
    return new Decimal(this.units + other.units, this.scale)
  }

  subtract(other: Decimal): Decimal {
    this.assertSameScale(other, 'subtract')
    return new Decimal(this.units - other.units, this.scale)
  }

  negate(): Decimal {
    return new Decimal(-this.units, this.scale)
  }

  abs(): Decimal {
    return this.units < 0n ? this.negate() : this
  }

  /** Multiply by an exact integer (e.g. a bag count). */
  multiplyByInteger(factor: number | bigint): Decimal {
    const f = typeof factor === 'number' ? BigInt(Math.trunc(factor)) : factor
    if (typeof factor === 'number' && !Number.isInteger(factor)) {
      throw new DecimalError(`multiplyByInteger requires an integer, received ${factor}`)
    }
    return new Decimal(this.units * f, this.scale)
  }

  /** Multiply by another decimal, returning a result at this decimal's scale. */
  multiply(other: Decimal, mode: RoundingMode = 'HALF_UP'): Decimal {
    const raw = this.units * other.units // scale = this.scale + other.scale
    return new Decimal(divideRounded(raw, pow10(other.scale), mode), this.scale)
  }

  /** Divide by an exact integer, rounding the remainder. */
  divideByInteger(divisor: number | bigint, mode: RoundingMode = 'HALF_UP'): Decimal {
    const d = typeof divisor === 'number' ? BigInt(Math.trunc(divisor)) : divisor
    if (d === 0n) throw new DecimalError('Division by zero')
    return new Decimal(divideRounded(this.units, d, mode), this.scale)
  }

  /**
   * `this / other` as a percentage, at `resultScale`.
   * Used for yield (output/input × 100) and mass-balance variance.
   */
  percentOf(other: Decimal, resultScale: number): Decimal {
    if (other.isZero()) throw new DecimalError('Cannot compute a percentage of zero')
    // Align scales, then compute (a * 100 * 10^resultScale) / b.
    const a = this.units * pow10(other.scale)
    const b = other.units * pow10(this.scale)
    if (b === 0n) throw new DecimalError('Cannot compute a percentage of zero')
    return new Decimal(divideRounded(a * 100n * pow10(resultScale), b, 'HALF_UP'), resultScale)
  }

  /**
   * Split into `parts` shares that sum EXACTLY back to this value.
   * The remainder is distributed one unit at a time to the leading shares, so
   * `100.00 / 3` becomes `33.34 + 33.33 + 33.33`, not three lossy thirds.
   * This is how labour earnings are split across a gang (M18).
   */
  allocate(parts: number): Decimal[] {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new DecimalError(`allocate requires a positive integer, received ${parts}`)
    }
    const n = BigInt(parts)
    const base = this.units / n
    let remainder = this.units - base * n // same sign as units

    const shares: Decimal[] = []
    const step = remainder < 0n ? -1n : 1n
    for (let i = 0; i < parts; i++) {
      let unit = base
      if (remainder !== 0n) {
        unit += step
        remainder -= step
      }
      shares.push(new Decimal(unit, this.scale))
    }
    return shares
  }

  /** Weighted allocation that also sums exactly. Weights must be non-negative integers. */
  allocateByWeights(weights: readonly number[]): Decimal[] {
    if (weights.length === 0) throw new DecimalError('allocateByWeights requires weights')
    if (weights.some((w) => !Number.isInteger(w) || w < 0)) {
      throw new DecimalError('Weights must be non-negative integers')
    }
    const total = weights.reduce((a, b) => a + b, 0)
    if (total === 0) throw new DecimalError('Weights must not sum to zero')

    const totalBig = BigInt(total)
    let allocated = 0n
    const shares: Decimal[] = []

    for (let i = 0; i < weights.length; i++) {
      const w = BigInt(weights[i] ?? 0)
      // Truncate toward zero, then hand the remainder out below.
      const share = (this.units * w) / totalBig
      shares.push(new Decimal(share, this.scale))
      allocated += share
    }

    let remainder = this.units - allocated
    const step = remainder < 0n ? -1n : 1n
    let i = 0
    while (remainder !== 0n && i < shares.length) {
      // Skip zero-weight participants — they are entitled to nothing.
      if ((weights[i] ?? 0) > 0) {
        shares[i] = new Decimal((shares[i] as Decimal).units + step, this.scale)
        remainder -= step
      }
      i = (i + 1) % shares.length
      if (i === 0 && weights.every((w) => w === 0)) break
    }
    return shares
  }

  // ── Comparison ────────────────────────────────────────────────────────────

  compare(other: Decimal): -1 | 0 | 1 {
    this.assertSameScale(other, 'compare')
    if (this.units < other.units) return -1
    if (this.units > other.units) return 1
    return 0
  }

  equals(other: Decimal): boolean {
    return this.scale === other.scale && this.units === other.units
  }

  lessThan(other: Decimal): boolean {
    return this.compare(other) < 0
  }
  lessThanOrEqual(other: Decimal): boolean {
    return this.compare(other) <= 0
  }
  greaterThan(other: Decimal): boolean {
    return this.compare(other) > 0
  }
  greaterThanOrEqual(other: Decimal): boolean {
    return this.compare(other) >= 0
  }

  isZero(): boolean {
    return this.units === 0n
  }
  isNegative(): boolean {
    return this.units < 0n
  }
  isPositive(): boolean {
    return this.units > 0n
  }

  static sum(values: readonly Decimal[], scale: number): Decimal {
    return values.reduce<Decimal>((acc, v) => acc.add(v), Decimal.zero(scale))
  }

  // ── Output ────────────────────────────────────────────────────────────────

  /** Canonical decimal string — the form written to Postgres `numeric`. */
  toString(): string {
    const negative = this.units < 0n
    const digits = (negative ? -this.units : this.units).toString()

    if (this.scale === 0) return (negative ? '-' : '') + digits

    const padded = digits.padStart(this.scale + 1, '0')
    const intPart = padded.slice(0, padded.length - this.scale)
    const fracPart = padded.slice(padded.length - this.scale)
    return `${negative ? '-' : ''}${intPart}.${fracPart}`
  }

  toJSON(): string {
    return this.toString()
  }

  /**
   * Lossy. For display and charting ONLY — never for arithmetic, comparison or persistence.
   * The name is deliberately unpleasant so it stands out in review.
   */
  toNumberUnsafe(): number {
    return Number(this.toString())
  }

  /** Locale-aware display string. */
  format(locale = 'en-US', options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: this.scale,
      maximumFractionDigits: this.scale,
      ...options,
    }).format(Number(this.toString()))
  }
}

/** Integer division with the remainder resolved by the given rounding mode. */
function divideRounded(numerator: bigint, divisor: bigint, mode: RoundingMode): bigint {
  if (divisor === 0n) throw new DecimalError('Division by zero')

  const negative = numerator < 0n !== divisor < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = divisor < 0n ? -divisor : divisor

  const quotient = n / d
  const remainder = n - quotient * d
  if (remainder === 0n) return negative ? -quotient : quotient

  let rounded = quotient
  const twice = remainder * 2n

  switch (mode) {
    case 'DOWN':
      break
    case 'HALF_UP':
      if (twice >= d) rounded += 1n
      break
    case 'HALF_EVEN':
      if (twice > d || (twice === d && quotient % 2n === 1n)) rounded += 1n
      break
  }

  return negative ? -rounded : rounded
}
