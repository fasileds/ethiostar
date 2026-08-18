'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { createDocumentTemplate, setDocumentTemplateActive } from '@modules/printing'

const jsonField = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine(
    (value) => {
      if (value === undefined) return true
      try {
        JSON.parse(value)
        return true
      } catch {
        return false
      }
    },
    { message: 'Not valid JSON.' },
  )
  .transform((value) => (value === undefined ? null : (JSON.parse(value) as unknown)))

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Enter a code.')
    .max(80)
    .regex(/^[A-Z0-9_]+$/, 'Use upper-case letters, digits and underscores only.'),
  documentType: z.string().trim().min(1, 'Choose a document type.').max(40),
  locale: z.enum(['en', 'am']),
  title: z.string().trim().min(1, 'Enter a title.').max(200),
  pageSize: z.enum(['A4', 'A5', 'LABEL_100X150']),
  layout: jsonField,
})

export const createDocumentTemplateAction = withAction({
  name: 'printing.createDocumentTemplate',
  permission: 'admin:manage_settings',
  schema: createSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createDocumentTemplate(tx, {
        code: input.code,
        documentType: input.documentType,
        locale: input.locale,
        title: input.title,
        pageSize: input.pageSize,
        layout: input.layout,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/templates')
  },
})

const toggleSchema = z.object({
  id: z.string().uuid(),
  isActive: z.coerce.boolean(),
})

export const setDocumentTemplateActiveAction = withAction({
  name: 'printing.setDocumentTemplateActive',
  permission: 'admin:manage_settings',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      setDocumentTemplateActive(tx, input.id, input.isActive, ctx.actor.userId),
    )
    revalidatePath('/admin/templates')
  },
})
