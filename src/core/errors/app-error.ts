import { ERROR_CODES, type ErrorCode } from './error-codes'

/** Field-level validation detail, shaped for form rendering. */
export interface FieldError {
  readonly path: string
  readonly code: string
  readonly message: string
}

export interface AppErrorOptions {
  readonly message?: string
  /** Structured detail. MUST NOT contain secrets — it may reach the client. */
  readonly details?: Readonly<Record<string, unknown>>
  readonly fieldErrors?: readonly FieldError[]
  readonly cause?: unknown
  /** Seconds until a retry is sensible (429/503). */
  readonly retryAfterSeconds?: number
}

/**
 * Base class for every error this application raises deliberately.
 *
 * `isOperational` separates "expected, explicable, safe to show" from "a bug or an outage".
 * Only non-operational errors are redacted to a generic message plus a request id.
 *
 * docs/architecture/06-cross-cutting.md §6.2
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly httpStatus: number
  readonly details: Readonly<Record<string, unknown>> | undefined
  readonly fieldErrors: readonly FieldError[] | undefined
  readonly retryAfterSeconds: number | undefined
  /** True when the error is part of the domain vocabulary; false for bugs and outages. */
  readonly isOperational: boolean

  constructor(
    code: ErrorCode,
    httpStatus: number,
    options: AppErrorOptions & { isOperational?: boolean } = {},
  ) {
    super(options.message ?? code, options.cause !== undefined ? { cause: options.cause } : {})
    this.name = new.target.name
    this.code = code
    this.httpStatus = httpStatus
    this.details = options.details
    this.fieldErrors = options.fieldErrors
    this.retryAfterSeconds = options.retryAfterSeconds
    this.isOperational = options.isOperational ?? true
    Error.captureStackTrace?.(this, new.target)
  }

  /** Safe to serialise to a client. Never includes `cause` or the stack. */
  toPublicJSON(): {
    code: ErrorCode
    message: string
    details?: Readonly<Record<string, unknown>>
    fieldErrors?: readonly FieldError[]
  } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
    }
  }

  static isAppError(value: unknown): value is AppError {
    return value instanceof AppError
  }
}

// ── Concrete types ───────────────────────────────────────────────────────────

export class ValidationError extends AppError {
  constructor(options: AppErrorOptions = {}) {
    super(ERROR_CODES.VALIDATION_FAILED, 422, {
      message: 'The submitted data is not valid.',
      ...options,
    })
  }
}

export class UnauthenticatedError extends AppError {
  constructor(code: ErrorCode = ERROR_CODES.UNAUTHENTICATED, options: AppErrorOptions = {}) {
    super(code, 401, { message: 'Authentication is required.', ...options })
  }
}

export class ForbiddenError extends AppError {
  constructor(code: ErrorCode = ERROR_CODES.FORBIDDEN, options: AppErrorOptions = {}) {
    super(code, 403, {
      message: 'You do not have permission to perform this action.',
      ...options,
    })
  }
}

/**
 * Also returned INSTEAD OF 403 for a cross-tenant probe: a 403 confirms the id exists,
 * which is itself a leak. See docs/architecture/05-security.md §5.2.
 */
export class NotFoundError extends AppError {
  constructor(options: AppErrorOptions = {}) {
    super(ERROR_CODES.NOT_FOUND, 404, { message: 'Not found.', ...options })
  }

  static of(entity: string, id?: string): NotFoundError {
    return new NotFoundError({
      message: `${entity} not found.`,
      details: { entity, ...(id ? { id } : {}) },
    })
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode = ERROR_CODES.CONFLICT, options: AppErrorOptions = {}) {
    super(code, 409, { message: 'The request conflicts with the current state.', ...options })
  }
}

/** Optimistic lock lost — the UI should tell the user someone else changed the record. */
export class ConcurrencyError extends AppError {
  constructor(entity: string, id: string) {
    super(ERROR_CODES.CONCURRENT_MODIFICATION, 409, {
      message: `This ${entity} was changed by someone else. Reload and try again.`,
      details: { entity, id },
    })
  }
}

/**
 * The interesting one: a rule of the business said no.
 * Mass balance, capacity, lifecycle, holds, reconciliation.
 */
export class BusinessRuleViolation extends AppError {
  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(code, 422, {
      message: 'This action is not permitted by a business rule.',
      ...options,
    })
  }
}

export class InvalidStateTransitionError extends BusinessRuleViolation {
  constructor(entity: string, from: string, to: string, allowed: readonly string[]) {
    super(ERROR_CODES.INVALID_STATE_TRANSITION, {
      message: `A ${entity} cannot move from ${from} to ${to}.`,
      details: {
        entity,
        from,
        to,
        allowed,
      },
    })
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number, options: AppErrorOptions = {}) {
    super(ERROR_CODES.RATE_LIMITED, 429, {
      message: 'Too many requests. Please wait and try again.',
      retryAfterSeconds,
      ...options,
    })
  }
}

/**
 * The only non-operational class: a dependency failed. The message is redacted in
 * production and replaced with a request id.
 */
export class InfrastructureError extends AppError {
  constructor(code: ErrorCode = ERROR_CODES.INTERNAL, options: AppErrorOptions = {}) {
    super(code, 500, {
      message: 'An unexpected error occurred.',
      ...options,
      isOperational: false,
    })
  }
}

// ── Normalisation ────────────────────────────────────────────────────────────

/**
 * Turn anything thrown into an AppError. Unknown throws become non-operational
 * InfrastructureErrors so they are redacted and logged at `error`.
 */
/**
 * Drizzle wraps every driver failure in `DrizzleQueryError`, whose own `.message` is just
 * `Failed query: <sql>\nparams: <params>` — the actual reason (constraint violated, bad
 * input, connection refused) is on `.cause`, one level down. Showing the wrapper's message
 * puts a raw SQL dump in front of the user and the log, instead of the one line that
 * actually explains what happened.
 */
function unwrapDriverError(error: Error): Error {
  if (
    'query' in error &&
    'params' in error &&
    error.cause instanceof Error &&
    typeof error.cause.message === 'string' &&
    error.cause.message.length > 0
  ) {
    return error.cause
  }
  return error
}

export function toAppError(thrown: unknown): AppError {
  if (AppError.isAppError(thrown)) return thrown

  if (thrown instanceof Error) {
    const reason = unwrapDriverError(thrown)
    return new InfrastructureError(ERROR_CODES.INTERNAL, {
      message: reason.message,
      cause: thrown,
    })
  }

  return new InfrastructureError(ERROR_CODES.INTERNAL, {
    message: 'Unknown error',
    details: { thrown: typeof thrown === 'object' ? '[object]' : String(thrown) },
  })
}
