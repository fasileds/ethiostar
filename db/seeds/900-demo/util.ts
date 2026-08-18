import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { SeedContext } from '../types'

/**
 * Shared helpers for the demo dataset.
 *
 * Everything created by db/seeds/900-demo is keyed off a STABLE, HUMAN-READABLE SEED
 * STRING (e.g. `customer:abyssinia-highland`), hashed down to a deterministic UUID. That
 * is what makes the whole demo idempotent with plain `on conflict (id) do nothing` even
 * on the many tables here that carry no other natural key (stock_movement, notification,
 * printed_document snapshots, …) — re-running `npm run seed:demo` regenerates the exact
 * same ids and inserts nothing twice.
 */

/** Deterministic, UUID-shaped id derived from a seed string. Not a real UUIDv7 (no time
 *  ordering is needed for demo rows), but valid RFC-4122 shape. */
export function demoId(seed: string): string {
  const hash = createHash('sha256').update(`ethiostar-demo:${seed}`).digest('hex')
  const bytes = hash.slice(0, 32)
  const version = '7'
  const variantChar = '89ab'[parseInt(bytes[16] as string, 16) % 4]
  return [
    bytes.slice(0, 8),
    bytes.slice(8, 12),
    version + bytes.slice(13, 16),
    variantChar + bytes.slice(17, 20),
    bytes.slice(20, 32),
  ].join('-')
}

/** A business-hours instant in Africa/Addis_Ababa (UTC+3, no DST). */
export function addis(dateOnly: string, hh: number, mm = 0): Date {
  const h = String(hh).padStart(2, '0')
  const m = String(mm).padStart(2, '0')
  return new Date(`${dateOnly}T${h}:${m}:00+03:00`)
}

/** `n` days before the anchor date (2026-08-17), formatted YYYY-MM-DD. */
export function daysAgo(n: number, anchor = '2026-08-17'): string {
  const d = new Date(`${anchor}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export function pick<T>(arr: readonly T[], i: number): T {
  const v = arr[((i % arr.length) + arr.length) % arr.length]
  if (v === undefined) throw new Error('pick: empty array')
  return v
}

/** Zero-padded human reference, e.g. ref('CNS', 2026, 7) -> 'CNS-2026-000007'. */
export function ref(prefix: string, year: number, n: number): string {
  return `${prefix}-${year}-${String(n).padStart(6, '0')}`
}

export interface StockMovementInput {
  seed: string
  occurredAt: Date
  movementType:
    | 'RECEIPT'
    | 'PLACEMENT'
    | 'TRANSFER_OUT'
    | 'TRANSFER_IN'
    | 'ISSUE_TO_JOB'
    | 'OUTPUT_FROM_JOB'
    | 'PROCESS_LOSS'
    | 'ADJUSTMENT_IN'
    | 'ADJUSTMENT_OUT'
    | 'DISPATCH_OUT'
    | 'COUNT_VARIANCE'
  lotId: string
  customerId: string
  consignmentId: string
  locationId: string
  quantityKg: string
  keshaCount: number
  bagTypeId?: string | null | undefined
  reasonCodeId?: string | null | undefined
  sourceType: string
  sourceId: string
  actorId: string
  narrative?: string | null | undefined
  correlationId: string
}

/**
 * Writes one stock_movement row. Folding into stock_balance is NOT done here — the
 * trg_stock_movement__apply_balance / fn_apply_stock_movement() trigger (migration 0012)
 * does that automatically, in the same transaction, for every row actually inserted, and it
 * only fires on rows that are actually inserted (a skipped `on conflict ... do nothing` row
 * fires no trigger). A second manual fold here — this function used to have one — double
 * counted every balance against what the trigger had already applied, which is exactly the
 * ledger/projection drift the trigger exists to make impossible.
 */
export async function postStockMovement(
  ctx: SeedContext,
  m: StockMovementInput,
): Promise<void> {
  const id = demoId(`stock_movement:${m.seed}`)
  await ctx.tx.execute(sql`
    insert into public.stock_movement
      (id, occurred_at, movement_type, lot_id, customer_id, consignment_id, location_id,
       quantity_kg, kesha_count, bag_type_id, reason_code_id, source_type, source_id,
       actor_id, narrative, correlation_id, created_by)
    values
      (${id}, ${m.occurredAt}, ${m.movementType}, ${m.lotId}, ${m.customerId},
       ${m.consignmentId}, ${m.locationId}, ${m.quantityKg}, ${m.keshaCount},
       ${m.bagTypeId ?? null}, ${m.reasonCodeId ?? null}, ${m.sourceType}, ${m.sourceId},
       ${m.actorId}, ${m.narrative ?? null}, ${m.correlationId}, ${m.actorId})
    -- stock_movement is partitioned BY RANGE (occurred_at) (docs/adr, migration 0012), so its
    -- actual primary key is the composite (id, occurred_at), not id alone.
    on conflict (id, occurred_at) do nothing
  `)
}

export interface KeshaMovementInput {
  seed: string
  occurredAt: Date
  branchId: string
  customerId: string
  consignmentId?: string | null | undefined
  bagTypeId?: string | null | undefined
  locationId?: string | null | undefined
  movementType:
    | 'RECEIVED_FULL'
    | 'EMPTIED'
    | 'REFILLED'
    | 'RETURNED_EMPTY'
    | 'RETURNED_FULL'
    | 'DAMAGED'
    | 'RETAINED'
    | 'ADJUSTMENT'
  keshaDelta: number
  condition?: 'GOOD' | 'DAMAGED' | 'UNUSABLE' | undefined
  sourceType: string
  sourceId: string
  reasonCode?: string | null | undefined
  note?: string | null | undefined
  actorId: string
  /** RECEIVED_FULL/RETURNED_FULL increase heldFull; EMPTIED moves full->empty;
   *  REFILLED moves empty->full; RETURNED_EMPTY/DAMAGED/RETAINED decrease heldEmpty. */
  balanceEffect: { heldFull?: number; heldEmpty?: number; damaged?: number; returned?: number }
}

/** Writes one kesha_movement row and folds it into kesha_balance, mirroring M13's
 *  append-only-ledger-plus-projection design the same way postStockMovement does for M11. */
export async function postKeshaMovement(
  ctx: SeedContext,
  m: KeshaMovementInput,
): Promise<void> {
  const id = demoId(`kesha_movement:${m.seed}`)
  const inserted = (await ctx.tx.execute(sql`
    insert into public.kesha_movement
      (id, branch_id, customer_id, consignment_id, bag_type_id, location_id, movement_type,
       kesha_delta, condition, source_type, source_id, reason_code, note, occurred_at,
       recorded_at, created_by)
    values
      (${id}, ${m.branchId}, ${m.customerId}, ${m.consignmentId ?? null}, ${m.bagTypeId ?? null},
       ${m.locationId ?? null}, ${m.movementType}, ${m.keshaDelta}, ${m.condition ?? 'GOOD'},
       ${m.sourceType}, ${m.sourceId}, ${m.reasonCode ?? null}, ${m.note ?? null},
       ${m.occurredAt}, now(), ${m.actorId})
    on conflict (id) do nothing
    returning id
  `)) as unknown as readonly unknown[]

  if (inserted.length === 0) return

  const balanceId = demoId(
    `kesha_balance:${m.customerId}:${m.bagTypeId ?? 'none'}:${m.branchId}`,
  )
  const fullDelta = m.balanceEffect.heldFull ?? 0
  const emptyDelta = m.balanceEffect.heldEmpty ?? 0
  const damagedDelta = m.balanceEffect.damaged ?? 0
  const returnedDelta = m.balanceEffect.returned ?? 0

  await ctx.tx.execute(sql`
    insert into public.kesha_balance
      (id, customer_id, bag_type_id, branch_id, held_full, held_empty, damaged, returned,
       last_movement_at, created_by)
    values
      (${balanceId}, ${m.customerId}, ${m.bagTypeId ?? null}, ${m.branchId},
       greatest(${fullDelta}, 0), greatest(${emptyDelta}, 0), greatest(${damagedDelta}, 0),
       greatest(${returnedDelta}, 0), ${m.occurredAt}, ${m.actorId})
    on conflict (customer_id, bag_type_id, branch_id) do update set
      held_full = public.kesha_balance.held_full + ${fullDelta},
      held_empty = public.kesha_balance.held_empty + ${emptyDelta},
      damaged = public.kesha_balance.damaged + ${damagedDelta},
      returned = public.kesha_balance.returned + ${returnedDelta},
      last_movement_at = ${m.occurredAt},
      updated_at = now()
  `)
}

/** Row-existence guard for idempotent inserts on tables with no convenient natural key
 *  beyond the demo-deterministic id (used where the insert has side effects like a balance
 *  fold that must not run twice, or where the table has neither an id PK nor a unique key
 *  we control). */
export async function rowExists(
  ctx: SeedContext,
  table: string,
  idColumn: string,
  id: string,
): Promise<boolean> {
  const rows = (await ctx.tx.execute(
    sql`select 1 from ${sql.raw(`public."${table}"`)} where ${sql.raw(`"${idColumn}"`)} = ${id}`,
  )) as unknown as readonly unknown[]
  return rows.length > 0
}
