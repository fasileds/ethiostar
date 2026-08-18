'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { releaseCreditHold } from '@modules/billing'

const schema = z.object({ holdId: z.string().uuid() })

export const releaseCreditHoldAction = withAction({
  name: 'billing.releaseCreditHold',
  permission: 'billing:manage_credit_hold',
  schema,
  handler: async (input, ctx) => {
    await releaseCreditHold(ctx.claims, { holdId: input.holdId, actorId: ctx.actor.userId })
    revalidatePath('/billing/holds')
    revalidatePath('/billing')
  },
})
