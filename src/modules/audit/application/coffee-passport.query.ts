import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { col } from '@db/helpers/list-query'

/**
 * M07 — the "coffee passport".
 *
 * The client document: "a single 'coffee passport' view showing the complete life of a
 * consignment on one timeline — request, arrival, weighing, storage, every transfer,
 * processing, each output, acceptance, dispatch."
 *
 * This is a QUERY, not a table. Because it is derived from the append-only sources
 * (domain_event and stock_movement), it CANNOT disagree with the record — which is exactly
 * its evidential value in a dispute. A maintained summary table could drift; this cannot.
 *
 * docs/architecture/03-domain-model.md §3.11
 */

export type PassportEntryKind = 'EVENT' | 'MOVEMENT'

export interface PassportEntry {
  readonly kind: PassportEntryKind
  readonly occurredAt: Date
  readonly recordedAt: Date
  /** Event name, or movement type. */
  readonly label: string
  readonly aggregateType: string | null
  readonly aggregateId: string | null
  readonly lotId: string | null
  readonly locationId: string | null
  readonly quantityKg: string | null
  readonly keshaCount: number | null
  readonly actorId: string | null
  readonly actorName: string | null
  readonly correlationId: string | null
  readonly detail: Record<string, unknown> | null
}

/**
 * The full timeline for a consignment and every lot descended from it.
 *
 * The recursive CTE walks `lot_lineage`, so a processing output lot appears on its parent
 * consignment's passport — which is the whole point of modelling lineage as edges.
 *
 * NOTE: this query references tables created in later roadmap steps (lot, lot_lineage,
 * stock_movement). It is written now because the passport is the acceptance criterion the
 * ledger design exists to satisfy, and writing it early keeps that design honest.
 */
function passportSql(consignmentId: string) {
  return sql`
    with recursive lot_tree as (
      -- Lots received directly under this consignment
      select l.id
      from public.lot l
      where l.consignment_id = ${consignmentId}

      union

      -- Output lots produced from them, transitively
      select ll.child_lot_id
      from public.lot_lineage ll
      join lot_tree lt on ll.parent_lot_id = lt.id
    ),

    events as (
      select
        'EVENT'::text            as kind,
        de.occurred_at,
        de.recorded_at,
        de.name                  as label,
        de.aggregate_type,
        de.aggregate_id,
        null::uuid               as lot_id,
        null::uuid               as location_id,
        null::numeric            as quantity_kg,
        null::integer            as kesha_count,
        de.actor_id,
        de.correlation_id,
        de.payload               as detail
      from public.domain_event de
      where (de.aggregate_type = 'Consignment' and de.aggregate_id = ${consignmentId})
         or (de.aggregate_type = 'Lot' and de.aggregate_id in (select id from lot_tree))
    ),

    movements as (
      select
        'MOVEMENT'::text         as kind,
        sm.occurred_at,
        sm.recorded_at,
        sm.movement_type         as label,
        'StockMovement'::text    as aggregate_type,
        sm.id                    as aggregate_id,
        sm.lot_id,
        sm.location_id,
        sm.quantity_kg,
        sm.kesha_count,
        sm.actor_id,
        sm.correlation_id,
        jsonb_build_object(
          'sourceType', sm.source_type,
          'sourceId',   sm.source_id,
          'narrative',  sm.narrative
        )                        as detail
      from public.stock_movement sm
      where sm.lot_id in (select id from lot_tree)
    ),

    combined as (
      select * from events
      union all
      select * from movements
    )

    select
      c.kind,
      c.occurred_at,
      c.recorded_at,
      c.label,
      c.aggregate_type,
      c.aggregate_id,
      c.lot_id,
      c.location_id,
      c.quantity_kg,
      c.kesha_count,
      c.actor_id,
      u.full_name as actor_name,
      c.correlation_id,
      c.detail
    from combined c
    left join public.app_user u on u.id = c.actor_id
    order by c.occurred_at asc, c.recorded_at asc
  `
}

export async function coffeePassport(tx: Tx, consignmentId: string): Promise<PassportEntry[]> {
  const result = await tx.execute(passportSql(consignmentId))
  const rows = result as unknown as Array<Record<string, unknown>>

  return rows.map((row): PassportEntry => ({
    kind: row.kind === 'MOVEMENT' ? 'MOVEMENT' : 'EVENT',
    occurredAt: col.date(row.occurred_at),
    recordedAt: col.date(row.recorded_at),
    label: String(row.label),
    aggregateType: (row.aggregate_type as string | null) ?? null,
    aggregateId: (row.aggregate_id as string | null) ?? null,
    lotId: (row.lot_id as string | null) ?? null,
    locationId: (row.location_id as string | null) ?? null,
    // numeric arrives as a string and stays one until a Weight parses it.
    quantityKg: (row.quantity_kg as string | null) ?? null,
    keshaCount: row.kesha_count === null ? null : Number(row.kesha_count),
    actorId: (row.actor_id as string | null) ?? null,
    actorName: (row.actor_name as string | null) ?? null,
    correlationId: (row.correlation_id as string | null) ?? null,
    detail: (row.detail as Record<string, unknown> | null) ?? null,
  }))
}

/**
 * Entity history — every audited change to one row, with before/after values.
 *
 * The client document: "a weight correction shows exactly what it was and what it became."
 */
export async function entityHistory(
  tx: Tx,
  entityType: string,
  entityId: string,
): Promise<
  Array<{
    operation: string
    occurredAt: Date
    actorId: string
    actorName: string | null
    changedFields: Record<string, { from: unknown; to: unknown }> | null
  }>
> {
  const result = await tx.execute(sql`
    select
      a.operation,
      a.occurred_at,
      a.actor_id,
      u.full_name as actor_name,
      a.changed_fields
    from public.audit_log a
    left join public.app_user u on u.id = a.actor_id
    where a.entity_type = ${entityType}
      and a.entity_id = ${entityId}
    order by a.occurred_at desc
  `)

  const rows = result as unknown as Array<Record<string, unknown>>

  return rows.map((row) => ({
    operation: String(row.operation),
    occurredAt: col.date(row.occurred_at),
    actorId: String(row.actor_id),
    actorName: (row.actor_name as string | null) ?? null,
    changedFields:
      (row.changed_fields as Record<string, { from: unknown; to: unknown }> | null) ?? null,
  }))
}
