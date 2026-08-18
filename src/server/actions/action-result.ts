import type { FieldError } from '@core/errors/app-error'
import type { ErrorCode } from '@core/errors/error-codes'

/**
 * What a Server Action returns to the client.
 *
 * Failures are RETURNED, not thrown. Throwing from an action surfaces the Next.js error
 * overlay in development and a generic digest in production, swallowing the user-facing
 * message — and `useActionState` cannot render what it never receives.
 *
 * docs/architecture/06-cross-cutting.md §6.2
 */
export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false
      readonly error: {
        readonly code: ErrorCode
        readonly message: string
        readonly fieldErrors?: readonly FieldError[]
        readonly details?: Readonly<Record<string, unknown>>
        /** Shown to the user so a support call can be tied to a log line. */
        readonly requestId?: string
        readonly retryAfterSeconds?: number
      }
    }

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

export function actionErr(error: {
  code: ErrorCode
  message: string
  fieldErrors?: readonly FieldError[]
  details?: Readonly<Record<string, unknown>>
  requestId?: string
  retryAfterSeconds?: number
}): ActionResult<never> {
  return { ok: false, error }
}

/** Field errors keyed by path, for rendering next to inputs. */
export function fieldErrorMap(result: ActionResult<unknown>): Readonly<Record<string, string>> {
  if (result.ok || !result.error.fieldErrors) return {}
  const map: Record<string, string> = {}
  for (const fieldError of result.error.fieldErrors) {
    map[fieldError.path] ??= fieldError.message
  }
  return map
}

/** The idle state for `useActionState`. */
export const ACTION_IDLE = {
  ok: true,
  data: undefined,
} as const satisfies ActionResult<undefined>
