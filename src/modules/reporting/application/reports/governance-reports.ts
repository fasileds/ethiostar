import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * Governance reports (client document §7.2, "Governance" group).
 *
 * Approval turnaround is left out of this pass — the workflow module's task table has the
 * timestamps but no single "decided this kind of thing in N hours" query yet; noted rather
 * than silently dropped.
 */

export interface UserAccessReviewRow {
  readonly fullName: string
  readonly email: string
  readonly status: string
  readonly lastSeenAt: Date | null
  readonly daysSinceLastSeen: number | null
}

const DORMANT_THRESHOLD_DAYS = 30

export async function userAccessReview(tx: Tx): Promise<readonly UserAccessReviewRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select u.full_name, u.email, u.status, u.last_seen_at,
        case when u.last_seen_at is null then null
          else extract(day from now() - u.last_seen_at)::int end as days_since_last_seen
      from public.app_user u
      where u.actor_kind = 'staff' and u.status <> 'SUSPENDED'
        and (u.status = 'DORMANT'
          or u.last_seen_at is null
          or u.last_seen_at < now() - (${DORMANT_THRESHOLD_DAYS} || ' days')::interval)
      order by u.last_seen_at asc nulls first
    `,
  )
  return rows.map((row) => ({
    fullName: col.text(row.full_name),
    email: col.text(row.email),
    status: col.text(row.status),
    lastSeenAt: col.dateOrNull(row.last_seen_at),
    daysSinceLastSeen: col.intOrNull(row.days_since_last_seen),
  }))
}

export interface StockAdjustmentAuditRow {
  readonly reference: string
  readonly lotReference: string
  readonly reasonCode: string
  readonly isException: boolean
  readonly quantityKgDelta: string
  readonly narrative: string | null
  readonly occurredAt: Date
  readonly actorName: string | null
}

export async function stockAdjustmentAudit(
  tx: Tx,
  params: { readonly periodStart: string; readonly periodEnd: string },
): Promise<readonly StockAdjustmentAuditRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select sa.reference, l.reference as lot_reference, rc.code as reason_code,
        rc.is_exception, sa.quantity_kg_delta, sa.narrative, sa.occurred_at,
        u.full_name as actor_name
      from public.stock_adjustment sa
      join public.lot l on l.id = sa.lot_id
      join public.reason_code rc on rc.id = sa.reason_code_id
      left join public.app_user u on u.id = sa.created_by
      where sa.occurred_at::date between ${params.periodStart}::date and ${params.periodEnd}::date
      order by sa.occurred_at desc
    `,
  )
  return rows.map((row) => ({
    reference: col.text(row.reference),
    lotReference: col.text(row.lot_reference),
    reasonCode: col.text(row.reason_code),
    isException: col.bool(row.is_exception),
    quantityKgDelta: col.numeric(row.quantity_kg_delta),
    narrative: col.textOrNull(row.narrative),
    occurredAt: col.date(row.occurred_at),
    actorName: col.textOrNull(row.actor_name),
  }))
}

export interface ConfigurationChangeHistoryRow {
  readonly settingKey: string
  readonly oldValue: string | null
  readonly newValue: string
  readonly reason: string | null
  readonly changedBy: string | null
  readonly changedAt: Date
}

/**
 * Reads `system_setting_history` directly rather than through `@modules/administration` —
 * administration sits at tier 8, one tier ABOVE reporting, so importing it would invert the
 * dependency graph. The table is the module's own append-only audit trail; reading it here is
 * the same pattern every other report in this file uses for a lower-tier module's tables.
 */
export async function configurationChangeHistory(
  tx: Tx,
  params: { readonly periodStart: string; readonly periodEnd: string },
): Promise<readonly ConfigurationChangeHistoryRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select h.setting_key, h.old_value, h.new_value, h.reason, h.changed_at,
        u.full_name as changed_by_name
      from public.system_setting_history h
      left join public.app_user u on u.id = h.changed_by
      where h.changed_at::date between ${params.periodStart}::date and ${params.periodEnd}::date
      order by h.changed_at desc
    `,
  )
  return rows.map((row) => ({
    settingKey: col.text(row.setting_key),
    oldValue: row.old_value === null ? null : JSON.stringify(row.old_value),
    newValue: JSON.stringify(row.new_value),
    reason: col.textOrNull(row.reason),
    changedBy: col.textOrNull(row.changed_by_name),
    changedAt: col.date(row.changed_at),
  }))
}
