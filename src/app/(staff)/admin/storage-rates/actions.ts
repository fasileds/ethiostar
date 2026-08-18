'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import {
  addStorageRateTier,
  setStorageRateTierActive,
  calculateStorageCharges,
} from '@modules/billing'

const createSchema = z.object({
  branchId: z.string().uuid('Choose a branch.'),
  fromDay: z.coerce.number().int().nonnegative(),
  ratePerKgPerDay: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount.'),
  currency: z.string().trim().length(3).default('ETB'),
})

export const addStorageRateTierAction = withAction({
  name: 'billing.addStorageRateTier',
  permission: 'billing:manage_storage_rates',
  schema: createSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      addStorageRateTier(tx, {
        branchId: input.branchId,
        fromDay: input.fromDay,
        ratePerKgPerDay: input.ratePerKgPerDay,
        currency: input.currency,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/storage-rates')
  },
})

const toggleSchema = z.object({ id: z.string().uuid(), isActive: z.coerce.boolean() })

export const setStorageRateTierActiveAction = withAction({
  name: 'billing.setStorageRateTierActive',
  permission: 'billing:manage_storage_rates',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      setStorageRateTierActive(tx, input.id, input.isActive, ctx.actor.userId),
    )
    revalidatePath('/admin/storage-rates')
  },
})

export const runStorageChargingAction = withAction({
  name: 'billing.runStorageCharging',
  permission: 'billing:manage_storage_rates',
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const result = await calculateStorageCharges(ctx.claims, { actorId: ctx.actor.userId })
    revalidatePath('/admin/storage-rates')
    revalidatePath('/billing')
    return result
  },
})
