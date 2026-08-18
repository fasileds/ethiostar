'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { updateSystemSetting } from '@modules/administration'

const schema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export const updateSettingAction = withAction({
  name: 'administration.updateSetting',
  permission: 'admin:manage_settings',
  schema,
  handler: async (input, ctx) => {
    await updateSystemSetting(
      ctx.claims,
      input.key,
      input.value,
      input.reason ?? null,
      ctx.actor.userId,
    )
    revalidatePath('/admin/settings')
  },
})
