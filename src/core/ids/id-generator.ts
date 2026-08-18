import { randomUUID, randomBytes, randomInt } from 'node:crypto'

/**
 * Identifier generation.
 *
 * UUIDv7 is time-ordered, so B-tree inserts stay local and the index does not fragment the
 * way UUIDv4 does at ledger scale — while remaining unguessable, which matters because ids
 * appear in URLs a customer can see.
 *
 * Generated in the application because Supabase Postgres does not expose a native `uuidv7()`.
 * See docs/architecture/04-database-and-migrations.md §4.1.
 */
export interface IdGenerator {
  /** A new time-ordered UUIDv7. */
  uuid(): string
  /** A cryptographically random, URL-safe token — QR tokens, activation links. */
  token(byteLength?: number): string
  /** A short human-quotable reference, e.g. an application tracking reference. */
  reference(prefix: string): string
}

/** RFC 9562 §5.7 UUIDv7: 48-bit big-endian timestamp, 4-bit version, 74 bits of randomness. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16)

  // 48-bit millisecond timestamp
  const ts = BigInt(now)
  bytes[0] = Number((ts >> 40n) & 0xffn)
  bytes[1] = Number((ts >> 32n) & 0xffn)
  bytes[2] = Number((ts >> 24n) & 0xffn)
  bytes[3] = Number((ts >> 16n) & 0xffn)
  bytes[4] = Number((ts >> 8n) & 0xffn)
  bytes[5] = Number(ts & 0xffn)

  // version 7
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70
  // RFC 4122 variant
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80

  const hex = bytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

/** Characters excluding I, L, O, U, 0, 1 — unambiguous when read aloud over a phone. */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

export class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return uuidv7()
  }

  token(byteLength = 32): string {
    return randomBytes(byteLength).toString('base64url')
  }

  reference(prefix: string): string {
    let body = ''
    for (let i = 0; i < 8; i++) {
      body += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]
    }
    return `${prefix}-${body}`
  }
}

export const idGenerator: IdGenerator = new CryptoIdGenerator()

/**
 * Deterministic generator for tests — sequential, readable ids make a failing assertion
 * legible instead of a wall of hex.
 */
export class FixedIdGenerator implements IdGenerator {
  private counter = 0

  constructor(private readonly prefix = '00000000-0000-7000-8000') {}

  uuid(): string {
    this.counter += 1
    return `${this.prefix}-${String(this.counter).padStart(12, '0')}`
  }

  token(byteLength = 32): string {
    this.counter += 1
    return `token-${this.counter}`.padEnd(byteLength, '0')
  }

  reference(prefix: string): string {
    this.counter += 1
    return `${prefix}-TEST${String(this.counter).padStart(4, '0')}`
  }
}

/** Validates the canonical UUID text form. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/** Extracts the embedded timestamp from a v7 UUID. Returns null for other versions. */
export function uuidv7Timestamp(uuid: string): Date | null {
  if (!isUuid(uuid)) return null
  const hex = uuid.replace(/-/g, '')
  if (hex[12] !== '7') return null
  return new Date(Number(BigInt('0x' + hex.slice(0, 12))))
}

/** Standard v4, for the rare case an unordered id is genuinely wanted. */
export function uuidv4(): string {
  return randomUUID()
}
