import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@config/constants'

/**
 * Keyset (cursor) pagination.
 *
 * OFFSET pagination on the ledger and the audit log degrades linearly: page 400 of the
 * audit log makes Postgres scan and discard 10,000 rows. On tables that grow without bound
 * — stock_movement, domain_event, audit_log — that is the difference between a page that
 * loads and one that times out.
 *
 * Keyset pagination scans only the rows it returns, forever.
 * A lint rule bans OFFSET on those tables.
 *
 * docs/architecture/04-database-and-migrations.md §4.8
 */

/**
 * An opaque cursor. Encoded so callers cannot construct one by hand and depend on its
 * shape — it is an implementation detail of the sort order.
 */
export type Cursor = string & { readonly __brand: 'Cursor' }

export interface KeysetPosition {
  /** The sort column's value on the last row of the previous page. */
  readonly sortValue: string
  /** The row id, breaking ties so the ordering is total and stable. */
  readonly id: string
}

export interface PageRequest {
  readonly limit: number
  readonly cursor?: Cursor | undefined
}

export interface Page<T> {
  readonly items: readonly T[]
  readonly nextCursor: Cursor | null
  readonly hasMore: boolean
}

export function encodeCursor(position: KeysetPosition): Cursor {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url') as Cursor
}

export function decodeCursor(cursor: Cursor | string): KeysetPosition | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as KeysetPosition).sortValue === 'string' &&
      typeof (parsed as KeysetPosition).id === 'string'
    ) {
      return parsed as KeysetPosition
    }
    return null
  } catch {
    // A malformed cursor is a client problem, not a server error: start from the top.
    return null
  }
}

/** Clamp a caller-supplied page size. Never trust a client-supplied limit. */
export function clampLimit(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PAGE_SIZE
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE)
}

export function pageRequest(limit?: number, cursor?: string): PageRequest {
  const parsed = cursor ? decodeCursor(cursor) : null
  return {
    limit: clampLimit(limit),
    ...(parsed ? { cursor: encodeCursor(parsed) } : {}),
  }
}

/**
 * Build a page from a query that fetched `limit + 1` rows.
 *
 * Fetching one extra row is how `hasMore` is answered without a second COUNT query — and a
 * COUNT over a growing ledger is exactly the query we are avoiding.
 */
export function buildPage<T>(
  rows: readonly T[],
  limit: number,
  toPosition: (row: T) => KeysetPosition,
): Page<T> {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]

  return {
    items,
    hasMore,
    nextCursor: hasMore && last !== undefined ? encodeCursor(toPosition(last)) : null,
  }
}
