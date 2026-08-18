'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { addLabourRate } from '@modules/labour'
import type { BusinessDate } from '@core/utils/date'

const createSchema = z.object({
  branchId: z.string().uuid('Choose a branch.'),
  activityTypeId: z.string().uuid('Choose an activity.'),
  rateBasis: z.enum(['PER_KG', 'PER_KESHA', 'PER_DAY', 'PER_HOUR'], {
    message: 'Choose a rate basis.',
  }),
  rateAmount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount like 12.50.'),
  currency: z.string().trim().length(3, 'Use a 3-letter currency code.').default('ETB'),
  effectiveFrom: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose an effective date.'),
})

export const createLabourRateAction = withAction({
  name: 'labour.addLabourRate',
  permission: 'admin:manage_settings',
  schema: createSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      addLabourRate(tx, {
        branchId: input.branchId,
        activityTypeId: input.activityTypeId,
        rateBasis: input.rateBasis,
        rateAmount: input.rateAmount,
        currency: input.currency,
        effectiveFrom: input.effectiveFrom as BusinessDate,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/labour-rates')
  },
})
