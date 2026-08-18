import { describe, it, expect } from 'vitest'
import {
  uuidv7,
  uuidv7Timestamp,
  isUuid,
  CryptoIdGenerator,
  FixedIdGenerator,
} from './id-generator'

describe('uuidv7', () => {
  it('produces a well-formed UUID with version 7 and the RFC 4122 variant', () => {
    const id = uuidv7()
    expect(isUuid(id)).toBe(true)
    expect(id[14]).toBe('7')
    expect(['8', '9', 'a', 'b']).toContain(id[19])
  })

  it('is time-ordered — the property that keeps B-tree inserts local', () => {
    const ids: string[] = []
    let t = Date.UTC(2026, 7, 12, 9, 0, 0)
    for (let i = 0; i < 200; i++) ids.push(uuidv7((t += 1)))
    expect([...ids].sort()).toEqual(ids)
  })

  it('embeds a recoverable timestamp', () => {
    const when = Date.UTC(2026, 7, 12, 9, 0, 0)
    const recovered = uuidv7Timestamp(uuidv7(when))
    expect(recovered?.getTime()).toBe(when)
  })

  it('returns null for a non-v7 uuid', () => {
    expect(uuidv7Timestamp('00000000-0000-4000-8000-000000000000')).toBeNull()
    expect(uuidv7Timestamp('not-a-uuid')).toBeNull()
  })

  it('is unguessable — 10k ids collide zero times', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 10_000; i++) seen.add(uuidv7())
    expect(seen.size).toBe(10_000)
  })
})

describe('CryptoIdGenerator', () => {
  const gen = new CryptoIdGenerator()

  it('generates URL-safe tokens of the requested entropy', () => {
    const token = gen.token(32)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(42)
  })

  it('generates unique tokens', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => gen.token()))
    expect(seen.size).toBe(1000)
  })

  it('generates a human-quotable reference with no ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const ref = gen.reference('APP')
      expect(ref).toMatch(/^APP-[2-9A-HJ-NP-TV-Z]{8}$/)
      // I, L, O, U, 0 and 1 are excluded — they are misread over a phone.
      expect(ref.slice(4)).not.toMatch(/[ILOU01]/)
    }
  })
})

describe('FixedIdGenerator (tests)', () => {
  it('is deterministic and sequential', () => {
    const gen = new FixedIdGenerator()
    expect(gen.uuid()).toBe('00000000-0000-7000-8000-000000000001')
    expect(gen.uuid()).toBe('00000000-0000-7000-8000-000000000002')
    expect(isUuid(gen.uuid())).toBe(true)
  })

  it('produces readable references', () => {
    const gen = new FixedIdGenerator()
    expect(gen.reference('APP')).toBe('APP-TEST0001')
  })
})
