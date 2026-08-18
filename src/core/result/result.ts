/**
 * Result<T, E> — for EXPECTED domain failures.
 *
 * "Capacity unavailable", "mass balance out of tolerance", "customer on hold" are normal
 * Tuesdays, not exceptions. Returning them keeps them in the type signature, so a caller
 * cannot forget to handle one. Throwing them hides the cases you should be handling behind
 * a try/catch that also swallows real bugs.
 *
 * Programmer errors and infrastructure failures are still THROWN — they are not part of the
 * domain vocabulary and there is nothing sensible for a caller to do with them.
 *
 * docs/architecture/06-cross-cutting.md §6.2
 */

export type Result<T, E> = Ok<T> | Err<E>

export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

export interface Err<E> {
  readonly ok: false
  readonly error: E
}

export function ok(): Result<void, never>
export function ok<T>(value: T): Result<T, never>
export function ok<T>(value?: T): Result<T | undefined, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok
}

/** Transform the success value, leaving a failure untouched. */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result
}

/** Transform the error, leaving a success untouched. */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error))
}

/** Chain another fallible step. Short-circuits on the first failure. */
export function andThen<T, U, E, F>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>,
): Result<U, E | F> {
  return result.ok ? fn(result.value) : result
}

/** Async chain. */
export async function andThenAsync<T, U, E, F>(
  result: Result<T, E>,
  fn: (value: T) => Promise<Result<U, F>>,
): Promise<Result<U, E | F>> {
  return result.ok ? fn(result.value) : result
}

/** Unwrap with a fallback. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback
}

/**
 * Unwrap or throw. Use ONLY where a failure genuinely indicates a programmer error —
 * e.g. after a check that already proved the value is present.
 */
export function unwrap<T, E>(result: Result<T, E>, message = 'Unwrapped a failed Result'): T {
  if (!result.ok) {
    const detail = result.error instanceof Error ? result.error.message : String(result.error)
    throw new Error(`${message}: ${detail}`)
  }
  return result.value
}

/**
 * Collect a list of Results into a Result of a list.
 * Fails fast on the first error — use `partition` when every error matters.
 */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = []
  for (const r of results) {
    if (!r.ok) return r
    values.push(r.value)
  }
  return ok(values)
}

/** Split into successes and failures — for validating a whole form at once. */
export function partition<T, E>(
  results: readonly Result<T, E>[],
): { values: T[]; errors: E[] } {
  const values: T[] = []
  const errors: E[] = []
  for (const r of results) {
    if (r.ok) values.push(r.value)
    else errors.push(r.error)
  }
  return { values, errors }
}

/** Run a throwing function and capture the throw as an error value. */
export function attempt<T>(fn: () => T): Result<T, unknown> {
  try {
    return ok(fn())
  } catch (error) {
    return err(error)
  }
}

/** Async variant of `attempt`. */
export async function attemptAsync<T>(fn: () => Promise<T>): Promise<Result<T, unknown>> {
  try {
    return ok(await fn())
  } catch (error) {
    return err(error)
  }
}
