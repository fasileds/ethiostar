'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import {
  createMachine,
  setMachineStatus,
  MACHINE_TYPES,
  MACHINE_STATUSES,
} from '@modules/scheduling'

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Enter a code.')
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Use upper-case letters, digits and underscores only.'),
  nameEn: z.string().trim().min(1, 'Enter a name.').max(200),
  machineType: z.enum(MACHINE_TYPES, { message: 'Choose a machine type.' }),
  ratedCapacityKgPerHour: z.coerce.number().positive('Enter a rated capacity above zero.'),
  efficiencyFactor: z.coerce
    .number()
    .gt(0, 'Enter a factor above zero.')
    .lte(1, 'Enter a factor of 1 or less.'),
})

export const createMachineAction = withAction({
  name: 'scheduling.createMachine',
  permission: 'admin:manage_settings',
  schema: createSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createMachine(tx, {
        code: input.code,
        nameEn: input.nameEn,
        machineType: input.machineType,
        ratedCapacityKgPerHour: String(input.ratedCapacityKgPerHour),
        efficiencyFactor: String(input.efficiencyFactor),
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/machines')
  },
})

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(MACHINE_STATUSES),
})

export const setMachineStatusAction = withAction({
  name: 'scheduling.setMachineStatus',
  permission: 'admin:manage_settings',
  schema: statusSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => setMachineStatus(tx, input.id, input.status, ctx.actor.userId))
    revalidatePath('/admin/machines')
  },
})
