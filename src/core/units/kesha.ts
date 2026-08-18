/**
 * A count of kesha — the bag or sack in which coffee is handled and counted.
 *
 * Not merely a unit of measure. Per the client document, the kesha count is:
 *   • what the store keeper can physically verify at the unloading bay,
 *   • the basis on which loading and unloading labour is paid (M18), and therefore
 *   • the basis of a direct cash outflow.
 *
 * It is always a whole number — half a bag is not a thing. Signed, because the stock
 * ledger records movements in both directions.
 */
export class KeshaCount {
  private constructor(private readonly value: number) {}

  static from(value: number): KeshaCount {
    if (!Number.isInteger(value)) {
      throw new RangeError(`Kesha count must be a whole number, received ${value}`)
    }
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Kesha count out of safe integer range: ${value}`)
    }
    return new KeshaCount(value)
  }

  /** Parse from the string form the database driver returns for an integer column. */
  static parse(value: string): KeshaCount {
    const trimmed = value.trim()
    if (!/^[+-]?\d+$/.test(trimmed)) {
      throw new RangeError(`Not an integer kesha count: "${value}"`)
    }
    return KeshaCount.from(Number(trimmed))
  }

  static positive(value: number, what = 'kesha count'): KeshaCount {
    const k = KeshaCount.from(value)
    if (!k.isPositive()) {
      throw new RangeError(`${what} must be greater than zero, received ${value}`)
    }
    return k
  }

  static nonNegative(value: number, what = 'kesha count'): KeshaCount {
    const k = KeshaCount.from(value)
    if (k.isNegative()) {
      throw new RangeError(`${what} must not be negative, received ${value}`)
    }
    return k
  }

  static zero(): KeshaCount {
    return new KeshaCount(0)
  }

  add(other: KeshaCount): KeshaCount {
    return KeshaCount.from(this.value + other.value)
  }

  subtract(other: KeshaCount): KeshaCount {
    return KeshaCount.from(this.value - other.value)
  }

  negate(): KeshaCount {
    return new KeshaCount(-this.value)
  }

  abs(): KeshaCount {
    return new KeshaCount(Math.abs(this.value))
  }

  static sum(counts: readonly KeshaCount[]): KeshaCount {
    return counts.reduce<KeshaCount>((acc, c) => acc.add(c), KeshaCount.zero())
  }

  compare(other: KeshaCount): -1 | 0 | 1 {
    if (this.value < other.value) return -1
    if (this.value > other.value) return 1
    return 0
  }

  equals(other: KeshaCount): boolean {
    return this.value === other.value
  }
  lessThan(other: KeshaCount): boolean {
    return this.value < other.value
  }
  lessThanOrEqual(other: KeshaCount): boolean {
    return this.value <= other.value
  }
  greaterThan(other: KeshaCount): boolean {
    return this.value > other.value
  }
  greaterThanOrEqual(other: KeshaCount): boolean {
    return this.value >= other.value
  }
  isZero(): boolean {
    return this.value === 0
  }
  isPositive(): boolean {
    return this.value > 0
  }
  isNegative(): boolean {
    return this.value < 0
  }

  assertNonNegative(what = 'kesha count'): void {
    if (this.isNegative()) {
      throw new RangeError(`${what} must not be negative, received ${this.value}`)
    }
  }

  /** Safe: the count is genuinely an integer, unlike a weight. */
  toNumber(): number {
    return this.value
  }

  toString(): string {
    return String(this.value)
  }

  toJSON(): number {
    return this.value
  }

  format(locale = 'en-US'): string {
    return `${new Intl.NumberFormat(locale).format(this.value)} kesha`
  }
}
