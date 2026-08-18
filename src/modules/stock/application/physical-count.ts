import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { BusinessRuleViolation, ConflictError } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { postMovements } from '../infrastructure/stock.repository'
import type { StockMovement } from '../domain/movement'

/**
 * Physical stock count (M12/M21 governance report §7.2).
 *
 * Three steps, each its own transaction, because a count spans a walk around the store —
 * holding one transaction open for the duration would hold locks on every lot in the room
 * for as long as the count takes:
 *
 *   1. startStockCount     snapshot expected balances into DRAFT lines.
 *   2. recordCountedLine   the counter enters what was physically found, per line.
 *   3. approveStockCount   posts COUNT_VARIANCE for every line where counted differs from
 *                          expected, and only for those — an agreeing line produces no
 *                          ledger noise.
 */

export async function startStockCount(
  tx: Tx,
  locationId: string,
  countedOn: string,
  actorId: string,
): Promise<{ countId: string; reference: string; lineCount: number }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.STOCK_COUNT, { actorId })

  await tx.execute(sql`
    insert into public.stock_count (
      id, reference, location_id, counted_on, status, counted_by,
      created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${locationId}::uuid, ${countedOn}::date, 'DRAFT',
      ${actorId}::uuid, ${actorId}::uuid, now(), now()
    )
  `)

  const balances = await rawRows(
    tx,
    sql`
      select lot_id, quantity_kg, kesha_count from public.stock_balance
      where location_id = ${locationId}::uuid and quantity_kg > 0
    `,
  )

  for (const balance of balances) {
    await tx.execute(sql`
      insert into public.stock_count_line (
        id, count_id, lot_id, expected_quantity_kg, expected_kesha_count,
        counted_quantity_kg, counted_kesha_count,
        created_by, created_at, updated_at
      ) values (
        ${uuidv7()}, ${id}::uuid, ${col.text(balance.lot_id)}::uuid,
        ${col.numeric(balance.quantity_kg)}::numeric, ${col.int(balance.kesha_count)},
        ${col.numeric(balance.quantity_kg)}::numeric, ${col.int(balance.kesha_count)},
        ${actorId}::uuid, now(), now()
      )
    `)
  }

  return { countId: id, reference: allocated.formatted, lineCount: balances.length }
}

export async function recordCountedLine(
  tx: Tx,
  lineId: string,
  countedQuantityKg: string,
  countedKeshaCount: number,
  reasonCodeId: string | null,
  narrative: string | null,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.stock_count_line
    set counted_quantity_kg = ${countedQuantityKg}::numeric,
        counted_kesha_count = ${countedKeshaCount},
        reason_code_id = ${reasonCodeId}::uuid, narrative = ${narrative},
        updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${lineId}::uuid
  `)
}

interface CountLine {
  readonly id: string
  readonly lotId: string
  readonly locationId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly bagTypeId: string | null
  readonly expectedQuantityKg: string
  readonly expectedKeshaCount: number
  readonly countedQuantityKg: string
  readonly countedKeshaCount: number
  readonly reasonCodeId: string | null
  readonly narrative: string | null
}

async function loadCountForApproval(
  tx: Tx,
  countId: string,
): Promise<{ locationId: string; lines: CountLine[] }> {
  const header = await rawRows(
    tx,
    sql`select location_id, status from public.stock_count where id = ${countId}::uuid for update`,
  )
  const headerRow = header[0]
  if (!headerRow) throw new Error(`Stock count ${countId} not found`)
  if (col.text(headerRow.status) !== 'DRAFT' && col.text(headerRow.status) !== 'COUNTED') {
    throw new ConflictError(ERROR_CODES.CONFLICT, {
      message: `Stock count ${countId} has already been ${col.text(headerRow.status).toLowerCase()}.`,
    })
  }

  const rows = await rawRows(
    tx,
    sql`
      select l.id, l.lot_id, b.location_id, b.customer_id, b.consignment_id, b.bag_type_id,
             l.expected_quantity_kg, l.expected_kesha_count,
             l.counted_quantity_kg, l.counted_kesha_count, l.reason_code_id, l.narrative
      from public.stock_count_line l
      join public.stock_balance b on b.lot_id = l.lot_id and b.location_id = ${col.text(headerRow.location_id)}::uuid
      where l.count_id = ${countId}::uuid
    `,
  )

  return {
    locationId: col.text(headerRow.location_id),
    lines: rows.map((row) => ({
      id: col.text(row.id),
      lotId: col.text(row.lot_id),
      locationId: col.text(row.location_id),
      customerId: col.text(row.customer_id),
      consignmentId: col.text(row.consignment_id),
      bagTypeId: col.textOrNull(row.bag_type_id),
      expectedQuantityKg: col.numeric(row.expected_quantity_kg),
      expectedKeshaCount: col.int(row.expected_kesha_count),
      countedQuantityKg: col.numeric(row.counted_quantity_kg),
      countedKeshaCount: col.int(row.counted_kesha_count),
      reasonCodeId: col.textOrNull(row.reason_code_id),
      narrative: col.textOrNull(row.narrative),
    })),
  }
}

function varianceMovement(
  line: CountLine,
  countId: string,
  actorId: string,
  occurredAt: Date,
  correlationId: string,
): StockMovement | null {
  const varianceKg = Weight.fromKg(line.countedQuantityKg).subtract(
    Weight.fromKg(line.expectedQuantityKg),
  )
  const varianceKesha = KeshaCount.from(line.countedKeshaCount).subtract(
    KeshaCount.from(line.expectedKeshaCount),
  )

  if (varianceKg.isZero() && varianceKesha.isZero()) return null

  if (!line.reasonCodeId) {
    throw new BusinessRuleViolation(ERROR_CODES.ADJUSTMENT_REASON_REQUIRED, {
      message: `Line for lot ${line.lotId} has a variance and needs a reason code before this count can be approved.`,
      details: { lotId: line.lotId },
    })
  }

  return {
    movementType: 'COUNT_VARIANCE',
    occurredAt,
    lotId: line.lotId,
    customerId: line.customerId,
    consignmentId: line.consignmentId,
    locationId: line.locationId,
    quantityKg: varianceKg,
    keshaCount: varianceKesha,
    bagTypeId: line.bagTypeId,
    reasonCodeId: line.reasonCodeId,
    sourceType: 'stock_count',
    sourceId: countId,
    actorId,
    witnessId: null,
    narrative: line.narrative,
    correlationId,
  }
}

/**
 * Approve a count: for every line where counted disagrees with expected, post a
 * `COUNT_VARIANCE` movement bringing the ledger to what was physically found. Every
 * variance line requires a reason code — the same "explained, not silent" rule the mass
 * balance and the bag reconciliation both apply.
 */
export async function approveStockCount(
  tx: Tx,
  countId: string,
  actorId: string,
  occurredAt: Date,
): Promise<{ varianceCount: number }> {
  const { lines } = await loadCountForApproval(tx, countId)
  const correlationId = uuidv7()

  const movements = lines
    .map((line) => varianceMovement(line, countId, actorId, occurredAt, correlationId))
    .filter((m): m is StockMovement => m !== null)

  if (movements.length > 0) {
    await postMovements(tx, movements)
  }

  await tx.execute(sql`
    update public.stock_count
    set status = 'APPROVED', approved_by = ${actorId}::uuid, approved_at = ${occurredAt},
        updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${countId}::uuid
  `)

  return { varianceCount: movements.length }
}

export async function cancelStockCount(
  tx: Tx,
  countId: string,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.stock_count
    set status = 'CANCELLED', updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${countId}::uuid and status in ('DRAFT', 'COUNTED')
  `)
}
