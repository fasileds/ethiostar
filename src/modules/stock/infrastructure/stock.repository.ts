import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { validateMovement, assertSufficientStock, type StockMovement } from '../domain/movement'

/**
 * The ledger write path.
 *
 * `postMovements` is THE ONLY WAY a row is ever written to `stock_movement`. Every other
 * operation in the system that moves coffee — receipt, placement, transfer, issue to a job,
 * output, loss, adjustment, dispatch — builds `StockMovement` values and calls this. There is
 * no second insert path, which is what makes "every kilogram is at a defined location" an
 * enforceable statement rather than a hope.
 *
 * ONE MOVEMENT AT A TIME, sequentially, inside the caller's transaction. Each iteration:
 *
 *   1. `validateMovement` — pure domain check (sign, location present, reason present).
 *   2. For an OUTFLOW, lock the balance row `FOR UPDATE` and pre-check sufficiency, so a
 *      genuine shortage fails with a clear `InsufficientStock` error rather than a raw
 *      constraint violation from step 4.
 *   3. Insert the append-only `stock_movement` row.
 *   4. Upsert `stock_balance`. The `ON CONFLICT ... DO UPDATE` takes the row lock that
 *      actually serialises concurrent writers to one (lot, location) — step 2's lock only
 *      protects the pre-check; this is the one the database itself enforces via the
 *      non-negative CHECK constraint as the backstop layer.
 *
 * docs/adr/0003-consignment-spine-and-stock-ledger.md
 */

async function currentBalance(
  tx: Tx,
  lotId: string,
  locationId: string,
): Promise<{ quantityKg: Weight; keshaCount: KeshaCount }> {
  const rows = await rawRows(
    tx,
    sql`
      select quantity_kg, kesha_count from public.stock_balance
      where lot_id = ${lotId}::uuid and location_id = ${locationId}::uuid
      for update
    `,
  )
  const row = rows[0]
  if (!row) return { quantityKg: Weight.zero(), keshaCount: KeshaCount.zero() }
  return {
    quantityKg: Weight.fromKg(col.numeric(row.quantity_kg)),
    keshaCount: KeshaCount.parse(String(col.int(row.kesha_count))),
  }
}

async function postOne(tx: Tx, movement: StockMovement): Promise<string> {
  validateMovement(movement)

  if (movement.quantityKg.isNegative() || movement.keshaCount.isNegative()) {
    const balance = await currentBalance(tx, movement.lotId, movement.locationId)
    assertSufficientStock(
      balance.quantityKg,
      balance.keshaCount,
      movement.quantityKg.abs(),
      movement.keshaCount.abs(),
      `Lot ${movement.lotId} at location ${movement.locationId}`,
    )
  }

  const id = uuidv7()

  await tx.execute(sql`
    insert into public.stock_movement (
      id, occurred_at, movement_type, lot_id, customer_id, consignment_id, location_id,
      quantity_kg, kesha_count, bag_type_id, reason_code_id,
      source_type, source_id, actor_id, witness_id, narrative, correlation_id,
      recorded_at, created_by, created_at
    ) values (
      ${id}, ${movement.occurredAt}, ${movement.movementType},
      ${movement.lotId}::uuid, ${movement.customerId}::uuid, ${movement.consignmentId}::uuid,
      ${movement.locationId}::uuid,
      ${movement.quantityKg.toKgString()}::numeric, ${movement.keshaCount.toNumber()},
      ${movement.bagTypeId}::uuid, ${movement.reasonCodeId}::uuid,
      ${movement.sourceType}, ${movement.sourceId}::uuid, ${movement.actorId}::uuid,
      ${movement.witnessId}::uuid, ${movement.narrative}, ${movement.correlationId}::uuid,
      now(), ${movement.actorId}::uuid, now()
    )
  `)

  await tx.execute(sql`
    insert into public.stock_balance (
      lot_id, location_id, customer_id, consignment_id, bag_type_id,
      quantity_kg, kesha_count, last_movement_id, updated_at
    ) values (
      ${movement.lotId}::uuid, ${movement.locationId}::uuid, ${movement.customerId}::uuid,
      ${movement.consignmentId}::uuid, ${movement.bagTypeId}::uuid,
      ${movement.quantityKg.toKgString()}::numeric, ${movement.keshaCount.toNumber()},
      ${id}, now()
    )
    on conflict (lot_id, location_id) do update set
      quantity_kg = public.stock_balance.quantity_kg + excluded.quantity_kg,
      kesha_count = public.stock_balance.kesha_count + excluded.kesha_count,
      last_movement_id = excluded.last_movement_id,
      updated_at = now()
  `)

  return id
}

/** Post one or more movements. Sequential, inside the caller's transaction. */
export async function postMovements(
  tx: Tx,
  movements: readonly StockMovement[],
): Promise<string[]> {
  const ids: string[] = []
  for (const movement of movements) {
    ids.push(await postOne(tx, movement))
  }
  return ids
}
