import 'server-only'
import { sql, type SQL } from 'drizzle-orm'
import type { Tx } from '../client'

/**
 * The shape every list screen shares.
 *
 * Each module writes its own SQL — a generic query builder over fifteen different joins
 * would be harder to read than fifteen queries. What IS shared is the paging protocol:
 * fetch `limit + 1`, use the extra row to answer `hasMore` without a COUNT, and carry the
 * cursor as (sort value, id) so the ordering is total.
 *
 * COUNT is deliberately absent. On tables that grow without bound — the ledger, the audit
 * log, gate events — an exact total costs a full scan on every page load to render a number
 * nobody acts on.
 */

export interface ListPage<T> {
  readonly items: readonly T[]
  readonly hasMore: boolean
  readonly nextCursor: string | null
}

export interface ListParams {
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

export const LIST_LIMIT_DEFAULT = 25
export const LIST_LIMIT_MAX = 100

export function listLimit(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return LIST_LIMIT_DEFAULT
  return Math.min(Math.max(Math.trunc(requested), 1), LIST_LIMIT_MAX)
}

/** Decode `<sortValue>|<id>`. Returns null for anything malformed — a bad cursor starts over. */
export function decodeListCursor(
  cursor: string | undefined,
): { sortValue: string; id: string } | null {
  if (!cursor) return null
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const separator = raw.lastIndexOf('|')
    if (separator < 1) return null

    const sortValue = raw.slice(0, separator)
    const id = raw.slice(separator + 1)
    // The id half is always a UUID. Checking it here means a hand-crafted cursor cannot
    // reach the query as an arbitrary string.
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null

    return { sortValue, id }
  } catch {
    return null
  }
}

export function encodeListCursor(sortValue: string, id: string): string {
  return Buffer.from(`${sortValue}|${id}`, 'utf8').toString('base64url')
}

/**
 * The keyset predicate, for a DESC ordering on `(sortColumn, idColumn)`.
 *
 * Returns empty SQL for the first page, which is what makes the call site read as one
 * expression rather than a branch.
 */
export function keysetBefore(
  sortColumn: SQL,
  idColumn: SQL,
  cursor: string | undefined,
  cast: 'timestamptz' | 'date' | 'text' = 'timestamptz',
): SQL {
  const decoded = decodeListCursor(cursor)
  if (!decoded) return sql``

  const castSql =
    cast === 'timestamptz'
      ? sql`${decoded.sortValue}::timestamptz`
      : cast === 'date'
        ? sql`${decoded.sortValue}::date`
        : sql`${decoded.sortValue}::text`

  return sql`and (${sortColumn}, ${idColumn}) < (${castSql}, ${decoded.id}::uuid)`
}

/** Slice the extra row off and build the next cursor from the last item kept. */
export function toListPage<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => { sortValue: string; id: string },
): ListPage<T> {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]

  if (!hasMore || last === undefined) {
    return { items, hasMore: false, nextCursor: null }
  }

  const position = cursorOf(last)
  return { items, hasMore: true, nextCursor: encodeListCursor(position.sortValue, position.id) }
}

/** Postgres returns timestamptz as a Date; cursors need a lossless string form. */
export function cursorValue(value: Date | string | null): string {
  if (value === null) return ''
  return value instanceof Date ? value.toISOString() : value
}

/** Rows come back from `tx.execute` untyped; this names the cast in one place. */
export async function rawRows(tx: Tx, query: SQL): Promise<Array<Record<string, unknown>>> {
  const result = await tx.execute(query)
  return result as unknown as Array<Record<string, unknown>>
}

/** Column readers — Postgres numerics are strings and must stay strings. */
export const col = {
  text: (value: unknown): string => String(value),
  textOrNull: (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value),
  int: (value: unknown): number => Number(value),
  intOrNull: (value: unknown): number | null =>
    value === null || value === undefined ? null : Number(value),
  /** Numeric stays a string until a Weight or Money value object parses it. */
  numeric: (value: unknown): string =>
    value === null || value === undefined ? '0' : String(value),
  numericOrNull: (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value),
  date: (value: unknown): Date => (value instanceof Date ? value : new Date(value as string)),
  dateOrNull: (value: unknown): Date | null =>
    value === null || value === undefined
      ? null
      : value instanceof Date
        ? value
        : new Date(value as string),
  bool: (value: unknown): boolean => Boolean(value),
}
