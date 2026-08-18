import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { uuidv7 } from '@core/ids/id-generator'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { postMovements } from '../infrastructure/stock.repository'
import type { StockMovement } from '../domain/movement'

/**
 * Post a stock adjustment — "the highest-risk operation in the system" per the schema's own
 * comment on `stock_adjustment` (threat T2). Gated by the distinct `stock:adjust`
 * permission at the action layer; this function additionally refuses a zero delta and
 * requires the reason code the schema and the domain both already mandate, so the guard
 * exists at every layer that could otherwise be bypassed by a future call site.
 */
export interface AdjustStockInput {
  readonly lotId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly locationId: string
  readonly quantityKgDelta: string
  readonly keshaCountDelta: number
  readonly bagTypeId: string | null
  readonly reasonCodeId: string
  readonly narrative?: string | null
  readonly occurredAt: Date
  readonly actorId: string
}

async function insertAdjustmentHeader(
  tx: Tx,
  id: string,
  reference: string,
  correlationId: string,
  quantityKgDelta: Weight,
  keshaCountDelta: KeshaCount,
  input: AdjustStockInput,
): Promise<void> {
  await tx.execute(sql`
    insert into public.stock_adjustment (
      id, reference, lot_id, location_id, quantity_kg_delta, kesha_count_delta,
      reason_code_id, narrative, occurred_at, correlation_id,
      created_by, created_at, updated_at
    ) values (
      ${id}, ${reference}, ${input.lotId}::uuid, ${input.locationId}::uuid,
      ${quantityKgDelta.toKgString()}::numeric, ${keshaCountDelta.toNumber()},
      ${input.reasonCodeId}::uuid, ${input.narrative ?? null}, ${input.occurredAt},
      ${correlationId}, ${input.actorId}::uuid, now(), now()
    )
  `)
}

export async function adjustStock(
  tx: Tx,
  input: AdjustStockInput,
): Promise<{ adjustmentId: string; reference: string }> {
  const quantityKgDelta = Weight.fromKg(input.quantityKgDelta)
  const keshaCountDelta = KeshaCount.from(input.keshaCountDelta)

  if (quantityKgDelta.isZero() && keshaCountDelta.isZero()) {
    throw new BusinessRuleViolation(ERROR_CODES.LEDGER_IMBALANCE, {
      message: 'An adjustment must change at least one quantity.',
    })
  }

  const id = uuidv7()
  const correlationId = uuidv7()

  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.STOCK_ADJUSTMENT, {
    actorId: input.actorId,
  })

  await insertAdjustmentHeader(
    tx,
    id,
    allocated.formatted,
    correlationId,
    quantityKgDelta,
    keshaCountDelta,
    input,
  )

  const movement: StockMovement = {
    movementType:
      quantityKgDelta.isNegative() || keshaCountDelta.isNegative()
        ? 'ADJUSTMENT_OUT'
        : 'ADJUSTMENT_IN',
    occurredAt: input.occurredAt,
    lotId: input.lotId,
    customerId: input.customerId,
    consignmentId: input.consignmentId,
    locationId: input.locationId,
    quantityKg: quantityKgDelta,
    keshaCount: keshaCountDelta,
    bagTypeId: input.bagTypeId,
    reasonCodeId: input.reasonCodeId,
    sourceType: 'stock_adjustment',
    sourceId: id,
    actorId: input.actorId,
    witnessId: null,
    narrative: input.narrative ?? null,
    correlationId,
  }

  await postMovements(tx, [movement])

  return { adjustmentId: id, reference: allocated.formatted }
}
