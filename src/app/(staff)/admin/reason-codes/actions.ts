'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { createReasonCode, setReasonCodeActive } from '@modules/master-data'

const createSchema = z.object({
  categoryId: z.string().uuid('Choose a category.'),
  code: z
    .string()
    .trim()
    .min(1, 'Enter a code.')
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Use upper-case letters, digits and underscores only.'),
  nameEn: z.string().trim().min(1, 'Enter a name.').max(200),
  description: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  requiresNarrative: z.coerce.boolean().optional().default(false),
  isException: z.coerce.boolean().optional().default(false),
})

export const createReasonCodeAction = withAction({
  name: 'masterData.createReasonCode',
  permission: 'admin:manage_settings',
  schema: createSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createReasonCode(tx, {
        categoryId: input.categoryId,
        code: input.code,
        nameEn: input.nameEn,
        description: input.description ?? null,
        requiresNarrative: input.requiresNarrative,
        isException: input.isException,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/reason-codes')
  },
})

const toggleSchema = z.object({
  id: z.string().uuid(),
  isActive: z.coerce.boolean(),
})

export const setReasonCodeActiveAction = withAction({
  name: 'masterData.setReasonCodeActive',
  permission: 'admin:manage_settings',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => setReasonCodeActive(tx, input.id, input.isActive, ctx.actor.userId))
    revalidatePath('/admin/reason-codes')
  },
})
