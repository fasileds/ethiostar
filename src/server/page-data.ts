import 'server-only'
import { cache } from 'react'
import { withAuthenticatedDb, ANON_CLAIMS, type DbClaims, type Tx } from '@db/client'
import { getActor } from './auth/dal'
import { checkDatabase, queryOr, type Readiness } from './readiness'

/**
 * Page data plumbing.
 *
 * Every list and detail screen needs the same four things: is the database ready, who is
 * asking, what claims does their transaction carry, and what should render when a query
 * fails. Repeating that in thirty pages guarantees one of them will forget the claims and
 * quietly run as anonymous — which under RLS returns an empty list rather than an error, so
 * nobody notices until a customer says "where is my coffee".
 *
 * `pageContext` is memoised per request by React `cache`, so a page with six regions
 * resolves the actor once.
 */

export interface PageContext {
  readonly readiness: Readiness
  readonly actor: Awaited<ReturnType<typeof getActor>>
  /** The claims to open a transaction with. ANON when nobody is signed in. */
  readonly claims: DbClaims
  readonly customerId: string | null
}

export const pageContext = cache(async (): Promise<PageContext> => {
  const readiness = await checkDatabase()
  const actor = readiness.ready ? await queryOr(null, getActor) : null

  const claims: DbClaims = actor
    ? {
        sub: actor.userId,
        role: 'authenticated',
        actor_kind: actor.actorKind,
        customer_id: actor.customerId,
        // Without `status` every staff-gated policy denies — fn_is_staff() requires
        // actor_kind = 'staff' AND status = 'ACTIVE'. Sourced from the database-backed
        // actor rather than the token, which is the authority everywhere else too.
        status: actor.status,
        aal: actor.assuranceLevel,
      }
    : ANON_CLAIMS

  return { readiness, actor, claims, customerId: actor?.customerId ?? null }
})

/**
 * Run a read query as the current actor, falling back when the database is not ready.
 *
 * The fallback is a rendering concern, not a data one: it lets the layout and the empty
 * state show on a machine with no migrations applied. It NEVER invents rows — an empty list
 * that says "the database is not set up" is honest; a list of plausible consignments is not.
 */
export async function pageQuery<T>(fallback: T, run: (tx: Tx) => Promise<T>): Promise<T> {
  const { claims } = await pageContext()
  return queryOr(fallback, () => withAuthenticatedDb(claims, run))
}

/** An empty keyset page, for use as a `pageQuery` fallback on list screens. */
export function emptyListPage<T>(): {
  items: readonly T[]
  hasMore: false
  nextCursor: null
} {
  return { items: [], hasMore: false, nextCursor: null }
}

/**
 * Normalise Next's `searchParams` into the flat, single-valued shape the list queries want.
 *
 * A repeated query parameter (`?status=A&status=B`) arrives as an array. Taking the first
 * value rather than joining it means a crafted URL cannot smuggle a second value into a
 * filter — the query already parameterises, but narrowing the type here removes the question.
 */
export function firstParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key]
  const single = Array.isArray(value) ? value[0] : value
  return single === '' ? undefined : single
}

/** The subset of search params a list screen carries across pagination and filter changes. */
export function listParams(
  params: Record<string, string | string[] | undefined>,
): Readonly<Record<string, string | undefined>> {
  return {
    status: firstParam(params, 'status'),
    q: firstParam(params, 'q'),
    on: firstParam(params, 'on'),
    cursor: firstParam(params, 'cursor'),
  }
}
