'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { approveDeliveryRequest, rejectDeliveryRequest } from '@modules/inbound'

const approveSchema = z.object({
  deliveryRequestId: z.string().uuid(),
  locationId: z.string().uuid('Choose where this will be stored.'),
})

export const approveDeliveryRequestAction = withAction({
  name: 'inbound.approveDeliveryRequest',
  permission: 'delivery_request:approve',
  schema: approveSchema,
  handler: async (input, ctx) => {
    await approveDeliveryRequest(ctx.claims, {
      deliveryRequestId: input.deliveryRequestId,
      locationId: input.locationId,
      actorId: ctx.actor.userId,
    })
    revalidatePath(`/delivery-requests/${input.deliveryRequestId}`)
    revalidatePath('/delivery-requests')
    revalidatePath('/warehouse')
  },
})

const rejectSchema = z.object({
  deliveryRequestId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Explain why this request is refused.').max(1000),
})

export const rejectDeliveryRequestAction = withAction({
  name: 'inbound.rejectDeliveryRequest',
  permission: 'delivery_request:reject',
  schema: rejectSchema,
  handler: async (input, ctx) => {
    await rejectDeliveryRequest(ctx.claims, {
      deliveryRequestId: input.deliveryRequestId,
      reason: input.reason,
      actorId: ctx.actor.userId,
    })
    revalidatePath(`/delivery-requests/${input.deliveryRequestId}`)
    revalidatePath('/delivery-requests')
  },
})
