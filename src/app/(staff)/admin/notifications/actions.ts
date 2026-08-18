'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import {
  createNotificationTemplate,
  setNotificationTemplateActive,
} from '@modules/notification'

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

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal('').transform(() => undefined))

const createSchema = z.object({
  code: z.string().trim().min(1, 'Enter a code.').max(120),
  channel: z.enum(['EMAIL']),
  locale: z.enum(['en', 'am']),
  subject: optionalText(300),
  body: z.string().trim().min(1, 'Enter a body.').max(20000),
  variables: jsonField,
})

export const createNotificationTemplateAction = withAction({
  name: 'notification.createNotificationTemplate',
  permission: 'admin:manage_settings',
  schema: createSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createNotificationTemplate(tx, {
        code: input.code,
        channel: input.channel,
        locale: input.locale,
        subject: input.subject ?? null,
        body: input.body,
        variables: input.variables,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/notifications')
  },
})

const toggleSchema = z.object({
  id: z.string().uuid(),
  isActive: z.coerce.boolean(),
})

export const setNotificationTemplateActiveAction = withAction({
  name: 'notification.setNotificationTemplateActive',
  permission: 'admin:manage_settings',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      setNotificationTemplateActive(tx, input.id, input.isActive, ctx.actor.userId),
    )
    revalidatePath('/admin/notifications')
  },
})
