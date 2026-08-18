'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { createContract } from '@modules/contracts'
import { DEFAULT_CURRENCY } from '@config/constants'
import { businessDate } from '@core/utils/date'

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal('').transform(() => undefined))

const schema = z.object({
  customerId: z.string().uuid('Choose a customer.'),
  branchId: z.string().uuid('Choose a branch.'),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose an effective date.'),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  freeStorageDays: z.coerce.number().int().min(0).default(0),
  paymentTermsDays: z.coerce.number().int().min(0).default(30),
  creditLimitAmount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter a number.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  notes: optionalText(1000),
})

export const createContractAction = withAction({
  name: 'contracts.createContract',
  permission: 'contract:create',
  schema,
  handler: async (input, ctx) => {
    const result = await createContract(ctx.claims, {
      customerId: input.customerId,
      branchId: input.branchId,
      effectiveFrom: businessDate(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? businessDate(input.effectiveTo) : null,
      freeStorageDays: input.freeStorageDays,
      paymentTermsDays: input.paymentTermsDays,
      creditLimitAmount: input.creditLimitAmount ?? null,
      currency: DEFAULT_CURRENCY,
      notes: input.notes ?? null,
      actorId: ctx.actor.userId,
    })

    revalidatePath('/contracts')
    return result
  },
})
