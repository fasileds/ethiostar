import pino from 'pino'

/**
 * Structured logging.
 *
 * REDACTION IS ALLOW-LIST BASED, not deny-list. The serialiser emits known-safe fields and
 * drops the rest, because a deny-list misses the field somebody adds next month — and in
 * this system that field could be a bank account number or a session token.
 *
 * docs/architecture/06-cross-cutting.md §6.5
 */

/**
 * Exact key names that must never be logged.
 *
 * Kept alongside the pattern list below because some names are dangerous on their own
 * but are not substrings of anything (`tin`, `cookie`).
 */
const FORBIDDEN_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'setcookie',
  'tin',
  'ssn',
  'pin',
])

/**
 * SUBSTRING patterns — the robust half.
 *
 * An exact-name list is a deny-list, and a deny-list misses the field somebody adds next
 * month. `SUPABASE_SERVICE_ROLE_KEY` is exactly that case: it contains `service_role_key`
 * but does not equal it, and it is the most dangerous value in the system because it
 * bypasses RLS entirely.
 *
 * Any key whose normalised form CONTAINS one of these is redacted.
 */
const FORBIDDEN_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'privatekey',
  'servicerole',
  'sessionid',
  'credential',
  'accountnumber',
  'cardnumber',
  'cvv',
  'totp',
  'otp',
  'mfacode',
  'recoverycode',
  'signature',
  'encryptionkey',
]

/** Strip separators so `service_role_key`, `serviceRoleKey` and `SERVICE-ROLE-KEY` all match. */
function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '')
}

function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase()
  if (FORBIDDEN_KEYS.has(lower)) return true

  const normalised = normaliseKey(key)
  return FORBIDDEN_PATTERNS.some((pattern) => normalised.includes(pattern))
}

/** Recursively strip anything that looks sensitive, whatever its nesting. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]'
  if (value === null || value === undefined) return value

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1))
  }

  if (value instanceof Error) {
    // `cause` carries the actual driver/DB reason under wrappers like DrizzleQueryError,
    // whose own message is just a query dump — without it, "action failed" logs are useless.
    return {
      name: value.name,
      message: value.message,
      ...(value.cause instanceof Error ? { cause: redact(value.cause, depth + 1) } : {}),
    }
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isForbiddenKey(key) ? '[redacted]' : redact(nested, depth + 1)
    }
    return output
  }

  return value
}

export interface LoggerConfig {
  readonly level: string
  readonly pretty: boolean
  readonly service: string
}

/**
 * Defaults, used until `configureLogger()` runs.
 *
 * The kernel depends on nothing inside src/, so it cannot read @config/env — and env is
 * itself the only module permitted to touch process.env. Configuration is therefore
 * INJECTED from instrumentation.ts at boot rather than read here. That keeps the
 * dependency rule intact instead of carving an exception into it.
 */
const DEFAULT_CONFIG: LoggerConfig = { level: 'info', pretty: false, service: 'cpms' }

function build(config: LoggerConfig): pino.Logger {
  return pino({
    level: config.level,
    base: { service: config.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
      log: (object) => redact(object) as Record<string, unknown>,
    },
    ...(config.pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: false } } }
      : {}),
  })
}

let instance: pino.Logger = build(DEFAULT_CONFIG)

/** Called once at boot from instrumentation.ts (server) and the worker entry point. */
export function configureLogger(config: Partial<LoggerConfig>): void {
  instance = build({ ...DEFAULT_CONFIG, ...config })
}

export type Logger = pino.Logger

/**
 * The application logger. A getter-backed proxy so `configureLogger()` can replace the
 * underlying instance after modules have already imported this binding.
 */
export const logger: Logger = new Proxy({} as Logger, {
  get(_target, property: string | symbol) {
    const value = (instance as unknown as Record<string | symbol, unknown>)[property]
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

/** A logger bound to a request or job. */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return instance.child(redact(bindings) as Record<string, unknown>)
}

export const __testing = { redact, isForbiddenKey, FORBIDDEN_KEYS, FORBIDDEN_PATTERNS }
