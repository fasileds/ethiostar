'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { businessDate } from '@core/utils/date'
import { createBagType, addBagTypeVersion, setBagTypeActive } from '@modules/master-data'

const weightSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, 'Enter a weight in kilograms.')

const optionalWeightSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, 'Enter a weight in kilograms.')
  .optional()
  .or(z.literal('').transform(() => undefined))

const optionalPercentSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, 'Enter a percentage.')
  .optional()
  .or(z.literal('').transform(() => undefined))

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')

const createBagTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Enter a code.')
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Use upper-case letters, digits and underscores only.'),
  nameEn: z.string().trim().min(1, 'Enter a name.').max(200),
  material: z
    .string()
    .trim()
    .max(100)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  ownership: z.enum(['ETHIOSTAR', 'CUSTOMER'], { message: 'Choose an ownership.' }),
  isReturnable: z.coerce.boolean().optional().default(false),
  standardNetWeightKg: weightSchema,
  tareWeightKg: optionalWeightSchema,
  weightTolerancePct: optionalPercentSchema,
  effectiveFrom: dateSchema,
})

export const createBagTypeAction = withAction({
  name: 'masterData.createBagType',
  permission: 'admin:manage_settings',
  schema: createBagTypeSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createBagType(tx, {
        code: input.code,
        nameEn: input.nameEn,
        material: input.material ?? null,
        ownership: input.ownership,
        isReturnable: input.isReturnable,
        standardNetWeightKg: input.standardNetWeightKg,
        tareWeightKg: input.tareWeightKg ?? null,
        weightTolerancePct: input.weightTolerancePct ?? null,
        effectiveFrom: businessDate(input.effectiveFrom),
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/bag-types')
  },
})

const addVersionSchema = z.object({
  bagTypeId: z.string().uuid(),
  standardNetWeightKg: weightSchema,
  tareWeightKg: optionalWeightSchema,
  weightTolerancePct: optionalPercentSchema,
  effectiveFrom: dateSchema,
})

export const addBagTypeVersionAction = withAction({
  name: 'masterData.addBagTypeVersion',
  permission: 'admin:manage_settings',
  schema: addVersionSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      addBagTypeVersion(tx, {
        bagTypeId: input.bagTypeId,
        standardNetWeightKg: input.standardNetWeightKg,
        tareWeightKg: input.tareWeightKg ?? null,
        weightTolerancePct: input.weightTolerancePct ?? null,
        effectiveFrom: businessDate(input.effectiveFrom),
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/bag-types')
  },
})

const toggleSchema = z.object({
  id: z.string().uuid(),
  isActive: z.coerce.boolean(),
})

export const setBagTypeActiveAction = withAction({
  name: 'masterData.setBagTypeActive',
  permission: 'admin:manage_settings',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => setBagTypeActive(tx, input.id, input.isActive, ctx.actor.userId))
    revalidatePath('/admin/bag-types')
  },
})
