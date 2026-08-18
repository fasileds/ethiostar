import 'server-only'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { averageKgPerKesha } from '@core/units/conversion'
import { systemClock } from '@core/clock/clock'
import {
  transitionConsignment,
  recordConsignmentReceipt,
  createLot,
  upsertLotPlacement,
} from '@modules/consignment'
import { postMovements, type StockMovement } from '@modules/stock'
import { consumeReservation } from '@modules/warehouse'
import { queueNotification, NOTIFICATION_TEMPLATES } from '@modules/notification'
import { findCustomer } from '@modules/customers'
import {
  lockDeliveryRequest,
  transitionDeliveryRequest,
} from '../infrastructure/delivery-request.repository'
import {
  createGoodsReceiptDraft,
  setGoodsReceiptLineLot,
  postGoodsReceiptRow,
  type GoodsReceiptLineInput,
} from '../infrastructure/goods-receipt.repository'

/**
 * Post a goods receipt — Stage 2's centre of gravity: "the store keeper counts and confirms
 * exactly what was unloaded... and the loading and unloading workers are paid on the basis
 * of that confirmed kesha count."
 *
 * Combines what the roadmap lists as three steps (weighing, kesha confirmation, placement)
 * into one posting, because in this data model all three are properties of the SAME
 * physical count taken at the same moment at the bay — see the scope note on
 * `DELIVERY_REQUEST_TRANSITIONS` for the same simplification applied to SCHEDULED/ARRIVED.
 *
 * One line becomes one lot. A line is a bag-type/coffee-type/grade combination, and a lot is
 * "a distinct, separately identifiable quantity" — the two are the same thing at receipt.
 */
export interface CreateGoodsReceiptInput {
  readonly deliveryRequestId: string
  readonly branchId: string
  readonly vehiclePlate: string | null
  readonly driverName: string | null
  readonly locationId: string
  readonly customerRepName: string | null
  readonly witnessId: string | null
  readonly notes: string | null
  readonly lines: readonly GoodsReceiptLineInput[]
  readonly actorId: string
}

export interface GoodsReceiptResult {
  readonly receiptId: string
  readonly reference: string
  readonly receivedQuantityKg: string
  readonly receivedKeshaCount: number
  readonly averageKgPerKesha: string | null
  readonly varianceKg: string | null
  readonly variancePct: string | null
}

type Header = Awaited<ReturnType<typeof lockDeliveryRequest>>

/** One lot per line, placed, with its RECEIPT movement. Returns the movements to post. */
async function createLotsForLines(
  tx: Tx,
  receiptId: string,
  lineIds: readonly string[],
  header: Header,
  input: CreateGoodsReceiptInput,
  now: Date,
  today: string,
): Promise<StockMovement[]> {
  const movements: StockMovement[] = []

  for (const [index, line] of input.lines.entries()) {
    const lineId = lineIds[index]
    if (!lineId || !header.consignmentId) continue

    const { id: lotId } = await createLot(tx, {
      consignmentId: header.consignmentId,
      customerId: header.customerId,
      coffeeTypeId: line.coffeeTypeId,
      coffeeGradeId: line.coffeeGradeId,
      bagTypeId: line.bagTypeId,
      outputClassificationId: null,
      initialQuantityKg: line.quantityKg,
      initialKeshaCount: line.keshaCount,
      storageStartDate: today,
      actorId: input.actorId,
      occurredAt: now,
      correlationId: receiptId,
    })

    await setGoodsReceiptLineLot(tx, lineId, lotId)
    await upsertLotPlacement(tx, lotId, input.locationId, now, input.actorId)

    movements.push({
      movementType: 'RECEIPT',
      occurredAt: now,
      lotId,
      customerId: header.customerId,
      consignmentId: header.consignmentId,
      locationId: input.locationId,
      quantityKg: Weight.positiveFromKg(line.quantityKg),
      keshaCount: KeshaCount.positive(line.keshaCount),
      bagTypeId: line.bagTypeId,
      reasonCodeId: null,
      sourceType: 'goods_receipt',
      sourceId: receiptId,
      actorId: input.actorId,
      witnessId: input.witnessId,
      narrative: null,
      correlationId: receiptId,
    })
  }

  return movements
}

async function notifyReceived(
  tx: Tx,
  header: Header,
  receipt: { id: string; reference: string },
  totals: { kg: Weight; kesha: KeshaCount },
  now: Date,
  actorId: string,
): Promise<void> {
  const customer = await findCustomer(tx, header.customerId)
  if (!customer?.primaryEmail) return

  const consignmentReference = header.consignmentReference ?? header.reference
  const common = {
    recipientAddress: customer.primaryEmail,
    recipientCustomerId: header.customerId,
    sourceType: 'goods_receipt',
    sourceId: receipt.id,
    actorId,
  } as const

  await queueNotification(tx, {
    ...common,
    templateCode: NOTIFICATION_TEMPLATES.COFFEE_RECEIVED,
    variables: {
      contactName: customer.legalName,
      consignmentReference,
      receivedWeightKg: totals.kg.toKgString(),
      keshaCount: totals.kesha.toNumber(),
      grnNumber: receipt.reference,
      receivedAt: now.toISOString(),
    },
  })

  await queueNotification(tx, {
    ...common,
    templateCode: NOTIFICATION_TEMPLATES.STORAGE_CONFIRMED,
    variables: {
      contactName: customer.legalName,
      consignmentReference,
      storedWeightKg: totals.kg.toKgString(),
      keshaCount: totals.kesha.toNumber(),
      placedAt: now.toISOString(),
    },
  })
}

interface Totals {
  readonly totalKg: Weight
  readonly totalKesha: KeshaCount
  readonly varianceKg: Weight
  readonly variancePct: ReturnType<Weight['percentOf']> | null
  readonly average: Weight | null
}

function computeTotals(input: CreateGoodsReceiptInput, header: Header): Totals {
  const totalKg = Weight.sum(input.lines.map((l) => Weight.positiveFromKg(l.quantityKg)))
  const totalKesha = KeshaCount.sum(input.lines.map((l) => KeshaCount.positive(l.keshaCount)))
  const declaredKg = Weight.fromKg(header.declaredQuantityKg)
  const varianceKg = totalKg.subtract(declaredKg)
  const variancePct = declaredKg.isZero() ? null : varianceKg.percentOf(declaredKg)
  const average = averageKgPerKesha(totalKg, totalKesha)
  return { totalKg, totalKesha, varianceKg, variancePct, average }
}

/** Post the consignment's confirmed figures, advance both lifecycles, release the reservation. */
async function finalizeConsignmentAndRequest(
  tx: Tx,
  header: Header,
  receiptId: string,
  totals: Totals,
  now: Date,
  today: string,
  input: CreateGoodsReceiptInput,
): Promise<void> {
  if (!header.consignmentId) return

  await recordConsignmentReceipt(tx, {
    id: header.consignmentId,
    receivedQuantityKg: totals.totalKg.toKgString(),
    receivedKeshaCount: totals.totalKesha.toNumber(),
    receivedAt: now,
    storageStartDate: today,
    actorId: input.actorId,
  })
  await transitionConsignment(tx, {
    id: header.consignmentId,
    to: 'RECEIVED',
    actorId: input.actorId,
    occurredAt: now,
    correlationId: receiptId,
  })
  await transitionConsignment(tx, {
    id: header.consignmentId,
    to: 'STORED',
    actorId: input.actorId,
    occurredAt: now,
    correlationId: receiptId,
  })

  await transitionDeliveryRequest(
    tx,
    input.deliveryRequestId,
    header.status,
    'RECEIVED',
    input.actorId,
  )
  await consumeReservation(tx, input.deliveryRequestId)
}

async function draftReceipt(
  tx: Tx,
  header: Header,
  input: CreateGoodsReceiptInput,
  totals: Totals,
  now: Date,
): Promise<{ id: string; reference: string; lineIds: string[] }> {
  if (!header.consignmentId) throw new Error('unreachable: caller already checked')

  return createGoodsReceiptDraft(tx, {
    branchId: input.branchId,
    consignmentId: header.consignmentId,
    deliveryRequestId: input.deliveryRequestId,
    customerId: header.customerId,
    vehiclePlate: input.vehiclePlate,
    driverName: input.driverName,
    receivedQuantityKg: totals.totalKg.toKgString(),
    receivedKeshaCount: totals.totalKesha.toNumber(),
    declaredQuantityKg: header.declaredQuantityKg,
    declaredKeshaCount: header.declaredKeshaCount,
    varianceKg: totals.varianceKg.toKgString(),
    variancePct: totals.variancePct?.toString() ?? null,
    locationId: input.locationId,
    occurredAt: now,
    receivedBy: input.actorId,
    customerRepName: input.customerRepName,
    notes: input.notes,
    lines: input.lines,
  })
}

export async function createGoodsReceipt(
  claims: DbClaims,
  input: CreateGoodsReceiptInput,
): Promise<GoodsReceiptResult> {
  return runInTransaction(claims, async (tx) => {
    const header = await lockDeliveryRequest(tx, input.deliveryRequestId)
    if (!header.consignmentId) {
      throw new Error(`Delivery request ${input.deliveryRequestId} has no consignment`)
    }

    const totals = computeTotals(input, header)
    const { totalKg, totalKesha, varianceKg, variancePct, average } = totals

    const now = systemClock.now()
    const today = now.toISOString().slice(0, 10)

    const receipt = await draftReceipt(tx, header, input, totals, now)

    const movements = await createLotsForLines(
      tx,
      receipt.id,
      receipt.lineIds,
      header,
      input,
      now,
      today,
    )
    await postMovements(tx, movements)
    await postGoodsReceiptRow(tx, receipt.id, now)

    await finalizeConsignmentAndRequest(tx, header, receipt.id, totals, now, today, input)
    await notifyReceived(
      tx,
      header,
      receipt,
      { kg: totalKg, kesha: totalKesha },
      now,
      input.actorId,
    )

    return {
      receiptId: receipt.id,
      reference: receipt.reference,
      receivedQuantityKg: totalKg.toKgString(),
      receivedKeshaCount: totalKesha.toNumber(),
      averageKgPerKesha: average?.toKgString() ?? null,
      varianceKg: varianceKg.toKgString(),
      variancePct: variancePct?.toString() ?? null,
    }
  })
}
