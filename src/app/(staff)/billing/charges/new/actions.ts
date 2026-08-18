'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { raiseChargeNow } from '@modules/billing'
import { SERVICE_CODE_LIST } from '@modules/contracts'

const schema = z.object({
  customerId: z.string().uuid('Choose a customer.'),
  branchId: z.string().uuid('Choose a branch.'),
  serviceCode: z.enum(SERVICE_CODE_LIST as [string, ...string[]]),
  sourceType: z.string().trim().min(1, 'Say what this charge is for.').max(60),
  sourceId: z.string().uuid('The source reference must be a valid id.'),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, 'Enter a number of kilograms, or days.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  keshaQuantity: z.coerce.number().int().nonnegative().optional(),
})

/** Manual charge entry — see `raise-charge.ts`'s note on why this exists as a staff action
 *  rather than automatic capture from every operational use case. */
export const raiseChargeAction = withAction({
  name: 'billing.raiseCharge',
  permission: 'billing:raise_charge',
  schema,
  handler: async (input, ctx) => {
    const result = await raiseChargeNow(ctx.claims, {
      customerId: input.customerId,
      branchId: input.branchId,
      serviceCode: input.serviceCode,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      quantity: input.quantity ?? null,
      keshaQuantity: input.keshaQuantity ?? null,
      actorId: ctx.actor.userId,
    })
    revalidatePath('/billing')
    return result
  },
})
