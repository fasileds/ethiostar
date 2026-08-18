'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import {
  createStaffUser,
  assignRole,
  revokeRole,
  suspendUser,
  reactivateUser,
  ROLE_CODES,
} from '@modules/identity'
import { queueNotification, NOTIFICATION_TEMPLATES } from '@modules/notification'
import { systemClock } from '@core/clock/clock'

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(150),
  roleCode: z.enum(Object.values(ROLE_CODES) as [string, ...string[]]),
})

export const createStaffUserAction = withAction({
  name: 'administration.createStaffUser',
  permission: 'admin:manage_users',
  schema: createSchema,
  handler: async (input, ctx) => {
    const created = await createStaffUser(ctx.claims, {
      email: input.email,
      fullName: input.fullName,
      roleCode: input.roleCode,
      createdBy: ctx.actor.userId,
    })

    await ctx.tx((tx) =>
      queueNotification(tx, {
        templateCode: NOTIFICATION_TEMPLATES.CUSTOMER_CREDENTIALS_ISSUED,
        recipientAddress: input.email,
        recipientUserId: created.userId,
        variables: {
          contactName: input.fullName,
          legalName: 'EthioStar',
          email: input.email,
          activationUrl: created.actionLink,
          expiryHours: 24,
        },
        sourceType: 'app_user',
        sourceId: created.userId,
        actorId: ctx.actor.userId,
      }),
    )

    revalidatePath('/admin/users')
  },
})

const roleSchema = z.object({
  userId: z.string().uuid(),
  roleCode: z.enum(Object.values(ROLE_CODES) as [string, ...string[]]),
})

export const assignRoleAction = withAction({
  name: 'administration.assignRole',
  permission: 'admin:manage_users',
  schema: roleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      assignRole(tx, {
        userId: input.userId,
        roleCode: input.roleCode,
        assignedBy: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/users')
  },
})

export const revokeRoleAction = withAction({
  name: 'administration.revokeRole',
  permission: 'admin:manage_users',
  schema: roleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => revokeRole(tx, input.userId, input.roleCode))
    revalidatePath('/admin/users')
  },
})

const suspendSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
})

export const suspendUserAction = withAction({
  name: 'administration.suspendUser',
  permission: 'admin:manage_users',
  schema: suspendSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => suspendUser(tx, input.userId, input.reason, systemClock.now()))
    revalidatePath('/admin/users')
  },
})

const reactivateSchema = z.object({ userId: z.string().uuid() })

export const reactivateUserAction = withAction({
  name: 'administration.reactivateUser',
  permission: 'admin:manage_users',
  schema: reactivateSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => reactivateUser(tx, input.userId))
    revalidatePath('/admin/users')
  },
})
