import { describe, it, expect } from 'vitest'
import { __testing } from './logger'

const { redact } = __testing

describe('log redaction — allow-list based, not deny-list', () => {
  it('redacts credentials at the top level', () => {
    const out = redact({ email: 'a@b.co', password: 'hunter2' }) as Record<string, unknown>
    expect(out.email).toBe('a@b.co')
    expect(out.password).toBe('[redacted]')
  })

  it('redacts however deeply nested', () => {
    const out = redact({
      request: { headers: { authorization: 'Bearer abc', accept: 'json' } },
    }) as Record<string, Record<string, Record<string, unknown>>>
    expect(out.request!.headers!.authorization).toBe('[redacted]')
    expect(out.request!.headers!.accept).toBe('json')
  })

  /**
   * Regression: an exact-name list missed SUPABASE_SERVICE_ROLE_KEY, which CONTAINS
   * `service_role_key` but does not equal it — and it is the most dangerous value in the
   * system because it bypasses RLS entirely. Matching is now substring-based over a
   * separator-stripped key.
   */
  it.each([
    'SUPABASE_SERVICE_ROLE_KEY',
    'service_role_key',
    'serviceRoleKey',
    'SERVICE-ROLE-KEY',
    'supabaseServiceRoleKey',
  ])('redacts %s — the service-role key bypasses RLS', (key) => {
    const out = redact({ [key]: 'ey...' }) as Record<string, unknown>
    expect(out[key]).toBe('[redacted]')
  })

  it.each([
    'password',
    'userPassword',
    'new_password',
    'accessToken',
    'refresh_token',
    'API_KEY',
    'encryptionKey',
    'totpSecret',
    'recovery_code',
    'bankAccountNumber',
    'cardNumber',
    'privateKey',
  ])('redacts naming variants of sensitive fields: %s', (key) => {
    const out = redact({ [key]: 'sensitive' }) as Record<string, unknown>
    expect(out[key]).toBe('[redacted]')
  })

  it('does not over-redact ordinary business fields', () => {
    const out = redact({
      customerName: 'Abebe Trading',
      consignmentNumber: 'GRN-2026-000123',
      quantityKg: '30000.000',
      keshaCount: 500,
      roomCode: 'R-01',
      tokenised: undefined,
    }) as Record<string, unknown>

    expect(out.customerName).toBe('Abebe Trading')
    expect(out.consignmentNumber).toBe('GRN-2026-000123')
    expect(out.quantityKg).toBe('30000.000')
    expect(out.keshaCount).toBe(500)
    expect(out.roomCode).toBe('R-01')
  })

  it('redacts customer financial and identity fields', () => {
    const out = redact({
      customer: { name: 'Abebe Trading', bank_account_number: '1000123456', tin: '0012345678' },
    }) as Record<string, Record<string, unknown>>
    expect(out.customer!.name).toBe('Abebe Trading')
    expect(out.customer!.bank_account_number).toBe('[redacted]')
    expect(out.customer!.tin).toBe('[redacted]')
  })

  it('redacts session and TOTP material', () => {
    const out = redact({
      session_id: 's1',
      refresh_token: 'r1',
      totp_secret: 't1',
    }) as Record<string, unknown>
    expect(out.session_id).toBe('[redacted]')
    expect(out.refresh_token).toBe('[redacted]')
    expect(out.totp_secret).toBe('[redacted]')
  })

  it('redacts inside arrays', () => {
    const out = redact({ users: [{ email: 'a@b.co', password: 'x' }] }) as {
      users: Array<Record<string, unknown>>
    }
    expect(out.users[0]!.email).toBe('a@b.co')
    expect(out.users[0]!.password).toBe('[redacted]')
  })

  it('reduces an Error to name and message — never the stack or cause chain', () => {
    const out = redact(new Error('boom')) as Record<string, unknown>
    expect(out).toEqual({ name: 'Error', message: 'boom' })
  })

  it('caps recursion depth rather than looping forever', () => {
    type Deep = { next?: Deep }
    const deep: Deep = {}
    let cursor = deep
    for (let i = 0; i < 20; i++) {
      cursor.next = {}
      cursor = cursor.next
    }
    expect(() => redact(deep)).not.toThrow()
    expect(JSON.stringify(redact(deep))).toContain('depth-limit')
  })

  it('caps array length so one bad log line cannot flood the pipeline', () => {
    const out = redact({ items: Array.from({ length: 500 }, (_, i) => i) }) as {
      items: number[]
    }
    expect(out.items).toHaveLength(50)
  })

  it('passes primitives through untouched', () => {
    expect(redact('plain')).toBe('plain')
    expect(redact(42)).toBe(42)
    expect(redact(null)).toBeNull()
    expect(redact(undefined)).toBeUndefined()
  })
})
