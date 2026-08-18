'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { submitDeliveryRequest } from '@modules/inbound'
import { findCustomer } from '@modules/customers'
import { ForbiddenError } from '@core/errors/app-error'

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal('').transform(() => undefined))

const schema = z.object({
  coffeeTypeId: optionalUuid,
  originWoredaId: optionalUuid,
  harvestYearId: optionalUuid,
  declaredQuantityKg: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, 'Enter a number of kilograms.'),
  declaredKeshaCount: z.coerce.number().int().positive('Enter a whole number of kesha.'),
  expectedArrivalOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
  expectedArrivalWindow: z
    .string()
    .trim()
    .max(50)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  transportMode: z
    .string()
    .trim()
    .max(50)
    .optional()
    .or(z.literal('').transform(() => undefined)),
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
  driverPhone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

/**
 * The customer's Stage 2 opening move: "the customer raises the Stage 2 letter of request
 * online, entering coffee type, origin, quantity in kg and kesha, expected arrival date,
 * transporter and vehicle details."
 */
export const submitDeliveryRequestAction = withAction({
  name: 'inbound.submitDeliveryRequest',
  permission: 'delivery_request:create',
  schema,
  handler: async (input, ctx) => {
    const customerId = ctx.actor.customerId
    if (!customerId) {
      throw new ForbiddenError(undefined, {
        message: 'Only a customer account may submit a delivery request.',
      })
    }

    const customer = await ctx.tx((tx) => findCustomer(tx, customerId))
    if (!customer) {
      throw new ForbiddenError(undefined, { message: 'Customer record not found.' })
    }

    const result = await submitDeliveryRequest(ctx.claims, {
      branchId: customer.branchId,
      customerId,
      coffeeTypeId: input.coffeeTypeId ?? null,
      originWoredaId: input.originWoredaId ?? null,
      harvestYearId: input.harvestYearId ?? null,
      declaredQuantityKg: input.declaredQuantityKg,
      declaredKeshaCount: input.declaredKeshaCount,
      expectedArrivalOn: input.expectedArrivalOn,
      expectedArrivalWindow: input.expectedArrivalWindow ?? null,
      transportMode: input.transportMode ?? null,
      vehiclePlate: input.vehiclePlate ?? null,
      driverName: input.driverName ?? null,
      driverPhone: input.driverPhone ?? null,
      notes: input.notes ?? null,
      actorId: ctx.actor.userId,
    })

    revalidatePath('/portal/delivery-requests')
    revalidatePath('/portal/dashboard')
    return result
  },
})
