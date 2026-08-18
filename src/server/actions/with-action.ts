import 'server-only'
import { headers } from 'next/headers'
import type { ZodType } from 'zod'
import { z } from 'zod'
import type { Actor, ScopeTarget } from '@modules/identity'
import { AppError, ValidationError, toAppError, type FieldError } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { isErr, type Result } from '@core/result/result'
import { HEADER_REQUEST_ID } from '@config/constants'
import { isProduction } from '@config/env'
import { logger } from '@core/logging/logger'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { getActor } from '../auth/dal'
import { requirePermission } from '../auth/authorize'
import { actionOk, actionErr, type ActionResult } from './action-result'

/**
 * THE SERVER ACTION WRAPPER.
 *
 * Every mutation entry point goes through this. It is what makes the cross-cutting concerns
 * actually apply, rather than being nine things each developer must remember:
 *
 *   request context → actor resolution → AUTHORIZATION → input validation → handler
 *   → error mapping → timing and metrics
 *
 * The authorization step is the important one. A Server Action is a directly reachable POST
 * endpoint whose id is discoverable, so the page that renders the button is not a guard.
 * `permission` is REQUIRED — declaring `'public'` is possible but explicit and greppable.
 *
 * docs/architecture/06-cross-cutting.md §6.10
 */

export interface ActionContext {
  readonly actor: Actor
  readonly requestId: string
  /**
   * The claims to open a transaction with.
   *
   * Handed to the handler so a use case that must span several transactions — anything with
   * I/O in the middle, such as an upload that scans between two writes — can open them
   * itself without reaching into `@server`, which the module tier rules forbid.
   *
   * A use case that needs ONE transaction should use `ctx.tx` instead.
   */
  readonly claims: DbClaims
  /**
   * Run `fn` in a single transaction as this actor, with RLS enforced and serialization
   * failures retried. The overwhelmingly common case: one use case, one transaction.
   */
  readonly tx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>
}

/** Context for a deliberately public action (the customer application form). */
export interface PublicActionContext {
  readonly actor: null
  readonly requestId: string
  /**
   * The original submission, before `schema` validation. The schema only covers statically
   * named fields; a handler that needs dynamically named ones (KYC files keyed by document
   * type id, which vary by business type) reads them from here instead.
   */
  readonly raw: unknown
}

interface BaseConfig<TIn, TOut> {
  /** Stable name for logs and metrics, e.g. `inbound.confirmKeshaCount`. */
  readonly name: string
  readonly schema: ZodType<TIn>
  readonly handler: (input: TIn, ctx: ActionContext) => Promise<Result<TOut, AppError> | TOut>
}

interface AuthenticatedConfig<TIn, TOut> extends BaseConfig<TIn, TOut> {
  readonly permission: string
  /** Derive the scope target from the validated input — rooms, warehouses, customers. */
  readonly scope?: (input: TIn) => ScopeTarget
  readonly requireMfa?: boolean
}

interface PublicConfig<TIn, TOut> {
  readonly name: string
  readonly permission: 'public'
  readonly schema: ZodType<TIn>
  readonly handler: (
    input: TIn,
    ctx: PublicActionContext,
  ) => Promise<Result<TOut, AppError> | TOut>
}

function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  }))
}

/** FormData → plain object, so one schema handles both progressive-enhancement and JSON. */
function normaliseInput(raw: unknown): unknown {
  if (!(raw instanceof FormData)) return raw

  const result: Record<string, unknown> = {}
  for (const [key, value] of raw.entries()) {
    const existing = result[key]
    if (existing === undefined) {
      result[key] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      result[key] = [existing, value]
    }
  }
  return result
}

async function currentRequestId(): Promise<string> {
  try {
    const headerList = await headers()
    return headerList.get(HEADER_REQUEST_ID) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Map any failure to a client-safe result.
 * Non-operational errors are redacted in production and replaced with the request id, which
 * is the key to the full detail in the log.
 */
function mapError(error: unknown, requestId: string, name: string): ActionResult<never> {
  const appError = toAppError(error)

  const log = logger.child({ action: name, requestId, code: appError.code })
  if (appError.isOperational) {
    log.warn({ err: appError.message }, 'action rejected')
  } else {
    log.error({ err: appError, stack: appError.stack }, 'action failed')
  }

  if (!appError.isOperational && isProduction()) {
    return actionErr({
      code: ERROR_CODES.INTERNAL,
      message: 'Something went wrong. Please quote this reference to support.',
      requestId,
    })
  }

  return actionErr({
    code: appError.code,
    message: appError.message,
    ...(appError.details ? { details: appError.details } : {}),
    ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
    ...(appError.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: appError.retryAfterSeconds }
      : {}),
    requestId,
  })
}

function unwrapHandlerResult<TOut>(value: Result<TOut, AppError> | TOut): TOut {
  if (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof (value as { ok: unknown }).ok === 'boolean'
  ) {
    const result = value as Result<TOut, AppError>
    if (isErr(result)) throw result.error
    return result.value
  }
  return value as TOut
}

/** Wrap an authenticated action. */
export function withAction<TIn, TOut>(
  config: AuthenticatedConfig<TIn, TOut>,
): (raw: unknown) => Promise<ActionResult<TOut>> {
  return async (raw: unknown): Promise<ActionResult<TOut>> => {
    const startedAt = performance.now()
    const requestId = await currentRequestId()

    try {
      const actor = await getActor()

      const parsed = config.schema.safeParse(normaliseInput(raw))
      if (!parsed.success) {
        throw new ValidationError({ fieldErrors: toFieldErrors(parsed.error) })
      }

      // Authorization AFTER validation so the scope target can be derived from the input,
      // but BEFORE the handler so no business logic runs unauthorised.
      requirePermission(actor, config.permission, {
        target: config.scope?.(parsed.data),
        ...(config.requireMfa !== undefined ? { requireMfa: config.requireMfa } : {}),
      })

      const claims: DbClaims = {
        sub: actor.userId,
        role: 'authenticated',
        actor_kind: actor.actorKind,
        customer_id: actor.customerId,
        // fn_is_staff() is `actor_kind = 'staff' AND status = 'ACTIVE'` — omitting status
        // satisfies half the predicate and silently denies every staff policy.
        status: actor.status,
        aal: actor.assuranceLevel,
      }

      const output = unwrapHandlerResult(
        await config.handler(parsed.data, {
          actor,
          requestId,
          claims,
          tx: (fn) => runInTransaction(claims, fn),
        }),
      )

      logger.info(
        {
          action: config.name,
          requestId,
          durationMs: Math.round(performance.now() - startedAt),
        },
        'action ok',
      )
      return actionOk(output)
    } catch (error) {
      return mapError(error, requestId, config.name)
    }
  }
}

/**
 * Wrap a deliberately public action. The `'public'` literal makes the absence of an
 * authorization check explicit and greppable — an omission cannot hide.
 */
export function withPublicAction<TIn, TOut>(
  config: PublicConfig<TIn, TOut>,
): (raw: unknown) => Promise<ActionResult<TOut>> {
  return async (raw: unknown): Promise<ActionResult<TOut>> => {
    const requestId = await currentRequestId()

    try {
      const parsed = config.schema.safeParse(normaliseInput(raw))
      if (!parsed.success) {
        throw new ValidationError({ fieldErrors: toFieldErrors(parsed.error) })
      }

      const output = unwrapHandlerResult(
        await config.handler(parsed.data, { actor: null, requestId, raw }),
      )
      return actionOk(output)
    } catch (error) {
      return mapError(error, requestId, config.name)
    }
  }
}
