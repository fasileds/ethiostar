'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import {
  createWarehouse,
  createRoom,
  createSection,
  setWarehouseActive,
  setRoomActive,
  setSectionActive,
} from '@modules/warehouse'

const codeSchema = z
  .string()
  .trim()
  .min(1, 'Enter a code.')
  .max(40)
  .regex(/^[A-Z0-9_]+$/, 'Use upper-case letters, digits and underscores only.')

const optionalDimension = z
  .string()
  .trim()
  .optional()
  .or(z.literal('').transform(() => undefined))
  .transform((value) => (value === undefined || value === '' ? null : value))

const createWarehouseSchema = z.object({
  branchId: z.string().uuid('Choose a branch.'),
  code: codeSchema,
  nameEn: z.string().trim().min(1, 'Enter a name.').max(200),
})

export const createWarehouseAction = withAction({
  name: 'warehouse.createWarehouse',
  permission: 'admin:manage_settings',
  schema: createWarehouseSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createWarehouse(tx, {
        branchId: input.branchId,
        code: input.code,
        nameEn: input.nameEn,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/warehouses')
  },
})

const createRoomSchema = z.object({
  warehouseId: z.string().uuid('Choose a warehouse.'),
  code: codeSchema,
  nameEn: z.string().trim().min(1, 'Enter a name.').max(200),
  lengthM: optionalDimension,
  widthM: optionalDimension,
  heightM: optionalDimension,
})

export const createRoomAction = withAction({
  name: 'warehouse.createRoom',
  permission: 'admin:manage_settings',
  schema: createRoomSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createRoom(tx, {
        warehouseId: input.warehouseId,
        code: input.code,
        nameEn: input.nameEn,
        lengthM: input.lengthM,
        widthM: input.widthM,
        heightM: input.heightM,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/warehouses')
  },
})

const createSectionSchema = z.object({
  roomId: z.string().uuid('Choose a room.'),
  code: codeSchema,
  nameEn: z.string().trim().min(1, 'Enter a name.').max(200),
  capacityKg: z.coerce.number().min(0, 'Enter a capacity of 0 or more.'),
  capacityKesha: z.coerce.number().int().min(0, 'Enter a whole number of 0 or more.'),
  isLossAccount: z.coerce.boolean().optional().default(false),
})

export const createSectionAction = withAction({
  name: 'warehouse.createSection',
  permission: 'admin:manage_settings',
  schema: createSectionSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createSection(tx, {
        roomId: input.roomId,
        code: input.code,
        nameEn: input.nameEn,
        capacityKg: String(input.capacityKg),
        capacityKesha: input.capacityKesha,
        isLossAccount: input.isLossAccount,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/warehouses')
  },
})

const toggleSchema = z.object({
  id: z.string().uuid(),
  isActive: z.coerce.boolean(),
})

export const setWarehouseActiveAction = withAction({
  name: 'warehouse.setWarehouseActive',
  permission: 'admin:manage_settings',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => setWarehouseActive(tx, input.id, input.isActive, ctx.actor.userId))
    revalidatePath('/admin/warehouses')
  },
})

export const setRoomActiveAction = withAction({
  name: 'warehouse.setRoomActive',
  permission: 'admin:manage_settings',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => setRoomActive(tx, input.id, input.isActive, ctx.actor.userId))
    revalidatePath('/admin/warehouses')
  },
})

export const setSectionActiveAction = withAction({
  name: 'warehouse.setSectionActive',
  permission: 'admin:manage_settings',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => setSectionActive(tx, input.id, input.isActive, ctx.actor.userId))
    revalidatePath('/admin/warehouses')
  },
})
