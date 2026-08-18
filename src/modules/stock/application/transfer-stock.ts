import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { uuidv7 } from '@core/ids/id-generator'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { buildTransfer } from '../domain/movement'
import { postMovements } from '../infrastructure/stock.repository'

/**
 * Transfer stock between two locations (M12).
 *
 * `buildTransfer` guarantees the two rows net to zero by construction; this only adds the
 * header row the store screens list against and allocates its reference.
 */
export interface TransferStockInput {
  readonly lotId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly fromLocationId: string
  readonly toLocationId: string
  readonly quantityKg: string
  readonly keshaCount: number
  readonly bagTypeId: string | null
  readonly reasonCodeId?: string | null
  readonly narrative?: string | null
  readonly occurredAt: Date
  readonly actorId: string
}

export async function transferStock(
  tx: Tx,
  input: TransferStockInput,
): Promise<{ transferId: string; reference: string }> {
  const id = uuidv7()
  const correlationId = uuidv7()

  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.STORE_TRANSFER, {
    actorId: input.actorId,
  })

  const movements = buildTransfer({
    from: input.fromLocationId,
    to: input.toLocationId,
    quantityKg: Weight.positiveFromKg(input.quantityKg, 'transfer quantity'),
    keshaCount: KeshaCount.positive(input.keshaCount, 'transfer kesha count'),
    lotId: input.lotId,
    customerId: input.customerId,
    consignmentId: input.consignmentId,
    bagTypeId: input.bagTypeId,
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    sourceId: id,
    correlationId,
    narrative: input.narrative ?? null,
  })

  await tx.execute(sql`
    insert into public.stock_transfer (
      id, reference, from_location_id, to_location_id, occurred_at,
      reason_code_id, narrative, correlation_id, created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.fromLocationId}::uuid, ${input.toLocationId}::uuid,
      ${input.occurredAt}, ${input.reasonCodeId ?? null}::uuid, ${input.narrative ?? null},
      ${correlationId}, ${input.actorId}::uuid, now(), now()
    )
  `)

  await postMovements(tx, movements)

  return { transferId: id, reference: allocated.formatted }
}
