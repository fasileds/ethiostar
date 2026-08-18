import { Decimal, type RoundingMode } from './decimal'
import { MONEY_DECIMAL_PLACES } from './scales'

/**
 * A monetary amount with an explicit currency.
 *
 * Phase 1 is single-currency (ETB), but the currency travels with the amount so that adding
 * a second one later is a validation change rather than a schema migration and an audit of
 * every arithmetic site. Used by M18 labour vouchers; M19 billing (Phase 2) builds on it.
 */
export class Money {
  private constructor(
    private readonly value: Decimal,
    readonly currency: string,
  ) {}

  static readonly SCALE = MONEY_DECIMAL_PLACES
  static readonly DEFAULT_CURRENCY = 'ETB'

  static parse(amount: string, currency: string = Money.DEFAULT_CURRENCY): Money {
    Money.assertCurrencyCode(currency)
    return new Money(Decimal.parse(amount, Money.SCALE), currency)
  }

  static fromMinorUnits(
    minor: number | bigint,
    currency: string = Money.DEFAULT_CURRENCY,
  ): Money {
    Money.assertCurrencyCode(currency)
    return new Money(Decimal.fromUnits(minor, Money.SCALE), currency)
  }

  static fromWholeUnits(amount: number, currency: string = Money.DEFAULT_CURRENCY): Money {
    Money.assertCurrencyCode(currency)
    return new Money(Decimal.fromInteger(amount, Money.SCALE), currency)
  }

  static zero(currency: string = Money.DEFAULT_CURRENCY): Money {
    Money.assertCurrencyCode(currency)
    return new Money(Decimal.zero(Money.SCALE), currency)
  }

  private static assertCurrencyCode(currency: string): void {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new RangeError(`Currency must be a 3-letter ISO 4217 code, received "${currency}"`)
    }
  }

  private assertSameCurrency(other: Money, op: string): void {
    if (other.currency !== this.currency) {
      throw new RangeError(
        `Cannot ${op} ${this.currency} and ${other.currency}. Convert explicitly.`,
      )
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other, 'add')
    return new Money(this.value.add(other.value), this.currency)
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, 'subtract')
    return new Money(this.value.subtract(other.value), this.currency)
  }

  negate(): Money {
    return new Money(this.value.negate(), this.currency)
  }

  abs(): Money {
    return new Money(this.value.abs(), this.currency)
  }

  /** Rate × quantity — the piece-rate calculation in M18. */
  timesCount(count: number): Money {
    return new Money(this.value.multiplyByInteger(count), this.currency)
  }

  /** Apply a multiplier such as an overtime or holiday premium. */
  timesRate(multiplier: Decimal, mode: RoundingMode = 'HALF_UP'): Money {
    return new Money(this.value.multiply(multiplier, mode), this.currency)
  }

  /**
   * Split across a gang so the shares sum EXACTLY back to the total.
   * `allocate` distributes the remainder rather than losing it.
   */
  allocate(parts: number): Money[] {
    return this.value.allocate(parts).map((d) => new Money(d, this.currency))
  }

  /** Split proportionally to each worker's individual count. */
  allocateByWeights(weights: readonly number[]): Money[] {
    return this.value.allocateByWeights(weights).map((d) => new Money(d, this.currency))
  }

  static sum(amounts: readonly Money[], currency: string = Money.DEFAULT_CURRENCY): Money {
    return amounts.reduce<Money>((acc, m) => acc.add(m), Money.zero(currency))
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other, 'compare')
    return this.value.compare(other.value)
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value)
  }
  lessThan(other: Money): boolean {
    return this.compare(other) < 0
  }
  greaterThan(other: Money): boolean {
    return this.compare(other) > 0
  }
  greaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0
  }
  isZero(): boolean {
    return this.value.isZero()
  }
  isNegative(): boolean {
    return this.value.isNegative()
  }
  isPositive(): boolean {
    return this.value.isPositive()
  }

  /** Canonical string for persistence: matches Postgres numeric(14,2). */
  toAmountString(): string {
    return this.value.toString()
  }

  toString(): string {
    return `${this.value.toString()} ${this.currency}`
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.value.toString(), currency: this.currency }
  }

  format(locale = 'en-US'): string {
    return this.value.format(locale, { style: 'currency', currency: this.currency })
  }

  get decimal(): Decimal {
    return this.value
  }
}
