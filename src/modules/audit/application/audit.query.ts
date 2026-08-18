import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import {
  rawRows,
  col,
  listLimit,
  keysetBefore,
  toListPage,
  cursorValue,
  type ListPage,
} from '@db/helpers/list-query'

/**
 * Audit read models.
 *
 * `audit_log` is partitioned and grows without bound, so paging is keyset only — an OFFSET
 * here is a lint error. The changed-fields diff is rendered from what the trigger captured,
 * which is only the columns that actually changed: a weight correction shows exactly what it
 * was and what it became, and nothing else.
 */

export interface AuditRow {
  readonly id: string
  readonly entityType: string
  readonly entityId: string | null
  readonly operation: string
  readonly actorId: string
  readonly actorName: string | null
  readonly occurredAt: Date
  readonly requestId: string | null
  readonly ipAddress: string | null
  readonly changedFields: readonly string[]
}

export async function listAuditLog(
  tx: Tx,
  filters: {
    entityType?: string | undefined
    entityId?: string | undefined
    actorId?: string | undefined
    operation?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<AuditRow>> {
  const limit = listLimit(filters.limit)

  const rows = await rawRows(
    tx,
    sql`
      select
        a.id, a.entity_type, a.entity_id, a.operation, a.actor_id, a.occurred_at,
        a.request_id, a.ip_address, a.changed_fields,
        u.full_name as actor_name
      from public.audit_log a
      left join public.app_user u on u.id = a.actor_id
      where 1 = 1
        ${filters.entityType ? sql`and a.entity_type = ${filters.entityType}` : sql``}
        ${filters.entityId ? sql`and a.entity_id = ${filters.entityId}::uuid` : sql``}
        ${filters.actorId ? sql`and a.actor_id = ${filters.actorId}::uuid` : sql``}
        ${filters.operation ? sql`and a.operation = ${filters.operation}` : sql``}
        ${keysetBefore(sql`a.occurred_at`, sql`a.id`, filters.cursor)}
      order by a.occurred_at desc, a.id desc
      limit ${limit + 1}
    `,
  )

  // Cursored from the driver's raw text, not the mapped `Date` — a `Date` only holds
  // millisecond precision while `occurred_at` is microsecond, and a bulk write (a seed, a
  // migration backfill) routinely puts hundreds of rows on the same millisecond. Cursoring
  // off the truncated value drops every row whose true timestamp rounds down to it.
  const cursorSource = new Map(rows.map((row) => [col.text(row.id), col.text(row.occurred_at)]))

  return toListPage(
    rows.map((row): AuditRow => {
      const changed = row.changed_fields
      return {
        id: col.text(row.id),
        entityType: col.text(row.entity_type),
        entityId: col.textOrNull(row.entity_id),
        operation: col.text(row.operation),
        actorId: col.text(row.actor_id),
        actorName: col.textOrNull(row.actor_name),
        occurredAt: col.date(row.occurred_at),
        requestId: col.textOrNull(row.request_id),
        ipAddress: col.textOrNull(row.ip_address),
        changedFields: Array.isArray(changed) ? changed.map(String) : [],
      }
    }),
    limit,
    (row) => ({
      sortValue: cursorSource.get(row.id) ?? cursorValue(row.occurredAt),
      id: row.id,
    }),
  )
}

/** The entity types actually present, for the filter. Reads the log, not a hardcoded list. */
export async function auditEntityTypes(
  tx: Tx,
): Promise<Array<{ type: string; total: number }>> {
  const rows = await rawRows(
    tx,
    sql`
      select entity_type, count(*)::int as total
      from public.audit_log
      where occurred_at > now() - interval '90 days'
      group by entity_type
      order by count(*) desc
      limit 40
    `,
  )
  return rows.map((row) => ({ type: col.text(row.entity_type), total: col.int(row.total) }))
}

export interface DomainEventRow {
  readonly id: string
  readonly name: string
  readonly aggregateType: string
  readonly aggregateId: string
  readonly occurredAt: Date
  readonly actorName: string | null
  readonly correlationId: string
}

export async function listDomainEvents(
  tx: Tx,
  filters: {
    name?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<DomainEventRow>> {
  const limit = listLimit(filters.limit)

  const rows = await rawRows(
    tx,
    sql`
      select
        e.id, e.name, e.aggregate_type, e.aggregate_id, e.occurred_at, e.correlation_id,
        u.full_name as actor_name
      from public.domain_event e
      left join public.app_user u on u.id = e.actor_id
      where 1 = 1
        ${filters.name ? sql`and e.name = ${filters.name}` : sql``}
        ${keysetBefore(sql`e.occurred_at`, sql`e.id`, filters.cursor)}
      order by e.occurred_at desc, e.id desc
      limit ${limit + 1}
    `,
  )

  // See listAuditLog: cursor off the raw microsecond text, not the millisecond-truncated Date.
  const cursorSource = new Map(rows.map((row) => [col.text(row.id), col.text(row.occurred_at)]))

  return toListPage(
    rows.map((row): DomainEventRow => ({
      id: col.text(row.id),
      name: col.text(row.name),
      aggregateType: col.text(row.aggregate_type),
      aggregateId: col.text(row.aggregate_id),
      occurredAt: col.date(row.occurred_at),
      actorName: col.textOrNull(row.actor_name),
      correlationId: col.text(row.correlation_id),
    })),
    limit,
    (row) => ({
      sortValue: cursorSource.get(row.id) ?? cursorValue(row.occurredAt),
      id: row.id,
    }),
  )
}

/**
 * Outbox health.
 *
 * A growing pending count or anything in the dead-letter table means events are not reaching
 * their handlers — notifications not sent, projections not updated. It belongs on an operator
 * screen, not only in a metrics dashboard nobody has open at 6am.
 */
export async function outboxHealth(
  tx: Tx,
): Promise<{ pending: number; oldestPendingAt: Date | null; deadLettered: number }> {
  const rows = await rawRows(
    tx,
    sql`
      select
        (select count(*) from public.outbox where status = 'PENDING')::int as pending,
        (select min(created_at) from public.outbox where status = 'PENDING')
          as oldest_pending_at,
        (select count(*) from public.outbox_dead_letter)::int as dead_lettered
    `,
  )

  const row = rows[0]
  return {
    pending: row ? col.int(row.pending) : 0,
    oldestPendingAt: row ? col.dateOrNull(row.oldest_pending_at) : null,
    deadLettered: row ? col.int(row.dead_lettered) : 0,
  }
}
