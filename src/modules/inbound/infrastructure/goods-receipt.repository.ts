import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { uuidv7 } from '@core/ids/id-generator'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'

export interface GoodsReceiptLineInput {
  readonly bagTypeId: string | null
  readonly coffeeTypeId: string | null
  readonly coffeeGradeId: string | null
  readonly quantityKg: string
  readonly keshaCount: number
}

export interface CreateGoodsReceiptInput {
  readonly branchId: string
  readonly consignmentId: string
  readonly deliveryRequestId: string | null
  readonly customerId: string
  readonly vehiclePlate: string | null
  readonly driverName: string | null
  readonly receivedQuantityKg: string
  readonly receivedKeshaCount: number
  readonly declaredQuantityKg: string | null
  readonly declaredKeshaCount: number | null
  readonly varianceKg: string | null
  readonly variancePct: string | null
  readonly locationId: string
  readonly occurredAt: Date
  readonly receivedBy: string
  readonly customerRepName: string | null
  readonly notes: string | null
  readonly lines: readonly GoodsReceiptLineInput[]
}

/** Insert the receipt header and lines as DRAFT. Posting (and lot creation) is a separate step. */
export async function createGoodsReceiptDraft(
  tx: Tx,
  input: CreateGoodsReceiptInput,
): Promise<{ id: string; reference: string; lineIds: string[] }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.GOODS_RECEIPT, {
    branchId: input.branchId,
    actorId: input.receivedBy,
  })

  await tx.execute(sql`
    insert into public.goods_receipt (
      id, reference, branch_id, consignment_id, delivery_request_id, customer_id, status,
      vehicle_plate, driver_name,
      received_quantity_kg, received_kesha_count, declared_quantity_kg, declared_kesha_count,
      variance_kg, variance_pct, location_id,
      occurred_at, received_by, customer_rep_name, notes,
      created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.branchId}::uuid, ${input.consignmentId}::uuid,
      ${input.deliveryRequestId}::uuid, ${input.customerId}::uuid, 'DRAFT',
      ${input.vehiclePlate}, ${input.driverName},
      ${input.receivedQuantityKg}::numeric, ${input.receivedKeshaCount},
      ${input.declaredQuantityKg}::numeric, ${input.declaredKeshaCount},
      ${input.varianceKg}::numeric, ${input.variancePct}::numeric, ${input.locationId}::uuid,
      ${input.occurredAt}, ${input.receivedBy}::uuid, ${input.customerRepName}, ${input.notes},
      ${input.receivedBy}::uuid, now(), now()
    )
  `)

  const lineIds: string[] = []
  for (const [index, line] of input.lines.entries()) {
    const lineId = uuidv7()
    lineIds.push(lineId)
    await tx.execute(sql`
      insert into public.goods_receipt_line (
        id, receipt_id, line_no, bag_type_id, coffee_type_id, coffee_grade_id,
        quantity_kg, kesha_count, location_id, created_by, created_at, updated_at
      ) values (
        ${lineId}, ${id}::uuid, ${index + 1}, ${line.bagTypeId}::uuid, ${line.coffeeTypeId}::uuid,
        ${line.coffeeGradeId}::uuid, ${line.quantityKg}::numeric, ${line.keshaCount},
        ${input.locationId}::uuid, ${input.receivedBy}::uuid, now(), now()
      )
    `)
  }

  return { id, reference: allocated.formatted, lineIds }
}

export async function setGoodsReceiptLineLot(
  tx: Tx,
  lineId: string,
  lotId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.goods_receipt_line set lot_id = ${lotId}::uuid, updated_at = now()
    where id = ${lineId}::uuid
  `)
}

export async function postGoodsReceiptRow(tx: Tx, id: string, postedAt: Date): Promise<void> {
  await tx.execute(sql`
    update public.goods_receipt set status = 'POSTED', posted_at = ${postedAt}, updated_at = now()
    where id = ${id}::uuid
  `)
}
