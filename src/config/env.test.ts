import { describe, it, expect } from 'vitest'
import { loadEnv } from './env'

/**
 * These tests exist because the env schema is the first thing anyone touches on a fresh
 * clone, and a confusing failure there costs an hour before a line of real work happens.
 */

/** The minimum a valid environment must carry. */
function baseEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: 'development',
    APP_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    DIRECT_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon-key-long-enough-to-pass',
    SUPABASE_SERVICE_ROLE_KEY: 'local-service-key-long-enough-to-pass',
    ENCRYPTION_KEY: 'D4ZhOX7TzNKH8mld7iR6/cKHIYXukp//SxIZ2GuV3Lo=',
    SMTP_HOST: '127.0.0.1',
    MAIL_FROM: 'noreply@ethiostar.local',
    ...overrides,
  }
}

describe('empty values are treated as unset', () => {
  /**
   * REGRESSION: `.env.example` writes `CLAMAV_PORT=` for optional variables, which is the
   * universal convention for "not set". Zod saw an empty string, `.optional()` never
   * applied, and `z.coerce.number().positive()` coerced it to 0 and refused to start.
   */
  it('accepts CLAMAV_PORT= (empty) as absent', () => {
    const env = loadEnv(baseEnv({ CLAMAV_HOST: '', CLAMAV_PORT: '' }))
    expect(env.CLAMAV_PORT).toBeUndefined()
    expect(env.CLAMAV_HOST).toBeUndefined()
  })

  it('accepts OTEL_EXPORTER_OTLP_ENDPOINT= (empty) as absent', () => {
    const env = loadEnv(baseEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: '' }))
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined()
  })

  it('accepts an empty optional encryption key in development', () => {
    const env = loadEnv(baseEnv({ NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: '' }))
    expect(env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY).toBeUndefined()
  })

  it('treats whitespace-only as absent too', () => {
    expect(loadEnv(baseEnv({ CLAMAV_PORT: '   ' })).CLAMAV_PORT).toBeUndefined()
  })

  it('still honours a real value', () => {
    expect(loadEnv(baseEnv({ CLAMAV_PORT: '3310' })).CLAMAV_PORT).toBe(3310)
  })
})

describe('defaults', () => {
  it('applies sensible development defaults', () => {
    const env = loadEnv(baseEnv())
    expect(env.DATABASE_POOL_MAX).toBe(10)
    expect(env.DEFAULT_LOCALE).toBe('en')
    expect(env.TIME_ZONE).toBe('UTC')
    expect(env.LOG_LEVEL).toBe('info')
    expect(env.SUPABASE_STORAGE_BUCKET).toBe('cpms-documents')
  })
})

describe('validation failures name every offending variable at once', () => {
  it('reports all problems, not just the first', () => {
    try {
      loadEnv({ NODE_ENV: 'development' })
      expect.unreachable('an empty environment must not validate')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('DATABASE_URL')
      expect(message).toContain('NEXT_PUBLIC_SUPABASE_URL')
      expect(message).toContain('ENCRYPTION_KEY')
    }
  })

  /**
   * A first `npm run dev` on a fresh clone hits every required variable at once, and nine
   * identical "expected string, received undefined" lines tell the developer nothing about
   * what to do.
   */
  it('adds a first-run hint when NOTHING is configured', () => {
    try {
      loadEnv({ NODE_ENV: 'development' })
      expect.unreachable()
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('never been configured')
      expect(message).toContain('.env.local')
      expect(message).toContain('supabase start')
    }
  })

  it('does NOT add the hint when only one value is wrong', () => {
    try {
      loadEnv(baseEnv({ APP_URL: 'not-a-url' }))
      expect.unreachable()
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('APP_URL')
      expect(message).not.toContain('never been configured')
    }
  })
})

describe('production refusals', () => {
  const prod = (overrides: Record<string, string> = {}) =>
    baseEnv({
      NODE_ENV: 'production',
      APP_URL: 'https://cpms.ethiostar.example',
      DATABASE_URL: 'postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
      CLAMAV_HOST: 'clamav',
      CLAMAV_PORT: '3310',
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: 'jwop1NVQKBKXJ0vH+La8XFls2NawZt7hZbjZ+q2NNYY=',
      SMTP_USER: 'apikey',
      SMTP_PASSWORD: 'secret',
      ...overrides,
    })

  it('accepts a correctly configured production environment', () => {
    expect(() => loadEnv(prod())).not.toThrow()
  })

  /**
   * Session-scoped state leaks between requests on the session pooler. The transaction
   * pooler is what makes the per-transaction RLS context safe.
   */
  it('refuses a production DATABASE_URL that is not the transaction pooler (6543)', () => {
    expect(() =>
      loadEnv(prod({ DATABASE_URL: 'postgresql://u:p@db.supabase.co:5432/postgres' })),
    ).toThrow(/transaction pooler/)
  })

  it('refuses plain http in production', () => {
    expect(() => loadEnv(prod({ APP_URL: 'http://cpms.ethiostar.example' }))).toThrow(/https/)
  })

  /** An unscanned file must never satisfy a KYC requirement — the M08 key control. */
  it('refuses production without a virus scanner', () => {
    const withoutScanner = prod()
    delete withoutScanner.CLAMAV_HOST
    expect(() => loadEnv(withoutScanner)).toThrow(/Virus scanning is mandatory/)
  })

  /** Without an explicit key, multi-instance deploys fail Server Actions intermittently. */
  it('refuses production without a Server Actions encryption key', () => {
    const withoutKey = prod()
    delete withoutKey.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
    expect(() => loadEnv(withoutKey)).toThrow(/multi-instance deploys/)
  })

  it('refuses production with unauthenticated SMTP', () => {
    const noAuth = prod()
    delete noAuth.SMTP_USER
    expect(() => loadEnv(noAuth)).toThrow(/Authenticated SMTP/)
  })
})

describe('the service-role key is never the anon key', () => {
  /** The anon key ships in the browser bundle; the service-role key bypasses RLS entirely. */
  it('refuses when the two are identical', () => {
    expect(() =>
      loadEnv(
        baseEnv({
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'the-very-same-key-value-here',
          SUPABASE_SERVICE_ROLE_KEY: 'the-very-same-key-value-here',
        }),
      ),
    ).toThrow(/must not equal the anon key/)
  })
})
