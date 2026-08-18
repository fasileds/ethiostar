'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { createGoodsReceipt, findDeliveryRequest } from '@modules/inbound'
import { NotFoundError } from '@core/errors/app-error'

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal('').transform(() => undefined))

/**
 * `normaliseInput` (server/actions/with-action.ts) already collapses repeated `FormData`
 * entries with the same `name` into an array, in document order. Rendering one input per line
 * under a shared `name` therefore produces parallel arrays — line `i`'s values sit at index `i`
 * in every array — with no index-parsing or hidden JSON field required.
 */
function lineArray<T extends z.ZodTypeAny>(item: T, minLength = 0) {
  const arraySchema =
    minLength > 0 ? z.array(item).min(minLength, 'Add at least one line.') : z.array(item)
  return z.preprocess(
    (value: unknown) => (value === undefined ? [] : Array.isArray(value) ? value : [value]),
    arraySchema,
  )
}

const schema = z.object({
  deliveryRequestId: z.string().uuid(),
  locationId: z.string().uuid('Choose a room and section.'),
  bagTypeId: lineArray(optionalUuid),
  coffeeTypeId: lineArray(optionalUuid),
  coffeeGradeId: lineArray(optionalUuid),
  quantityKg: lineArray(
    z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,3})?$/, 'Enter a number of kilograms.'),
    1,
  ),
  keshaCount: lineArray(z.coerce.number().int().positive('Enter a whole number of kesha.')),
  vehiclePlate: z
    .string()
    .trim()
    .max(30)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  driverName: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  customerRepName: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  witnessId: optionalUuid,
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

/** Post the goods receipt — the moment coffee becomes EthioStar's custody. */
export const createGoodsReceiptAction = withAction({
  name: 'inbound.createGoodsReceipt',
  permission: 'goods_receipt:create',
  schema,
  handler: async (input, ctx) => {
    const request = await ctx.tx((tx) => findDeliveryRequest(tx, input.deliveryRequestId))
    if (!request) throw NotFoundError.of('Delivery request', input.deliveryRequestId)

    const result = await createGoodsReceipt(ctx.claims, {
      deliveryRequestId: input.deliveryRequestId,
      branchId: request.branchId,
      vehiclePlate: input.vehiclePlate ?? request.vehiclePlate ?? null,
      driverName: input.driverName ?? request.driverName ?? null,
      locationId: input.locationId,
      customerRepName: input.customerRepName ?? null,
      witnessId: input.witnessId ?? null,
      notes: input.notes ?? null,
      lines: input.quantityKg.map((quantityKg, index) => ({
        bagTypeId: input.bagTypeId[index] ?? null,
        coffeeTypeId: input.coffeeTypeId[index] ?? null,
        coffeeGradeId: input.coffeeGradeId[index] ?? null,
        quantityKg,
        keshaCount: input.keshaCount[index] ?? 0,
      })),
      actorId: ctx.actor.userId,
    })

    revalidatePath('/receiving')
    revalidatePath(`/delivery-requests/${input.deliveryRequestId}`)
    revalidatePath('/warehouse')
    revalidatePath('/consignments')
    return result
  },
})
