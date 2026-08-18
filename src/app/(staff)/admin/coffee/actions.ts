'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import {
  createCoffeeType,
  setCoffeeTypeActive,
  createCoffeeGrade,
  setCoffeeGradeActive,
  createScreenSize,
  setScreenSizeActive,
  createCertification,
  setCertificationActive,
  createHarvestYear,
  setHarvestYearActive,
} from '@modules/master-data'

const codeSchema = z
  .string()
  .trim()
  .min(1, 'Enter a code.')
  .max(40)
  .regex(/^[A-Z0-9_]+$/, 'Use upper-case letters, digits and underscores only.')

const nameSchema = z.string().trim().min(1, 'Enter a name.').max(200)

const toggleSchema = z.object({
  id: z.string().uuid(),
  isActive: z.coerce.boolean(),
})

// ── Coffee type ──────────────────────────────────────────────────────────────

const createCoffeeTypeSchema = z.object({
  code: codeSchema,
  nameEn: nameSchema,
  massBalanceTolerancePct: z
    .string()
    .trim()
    .max(20)
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export const createCoffeeTypeAction = withAction({
  name: 'masterData.createCoffeeType',
  permission: 'admin:manage_settings',
  schema: createCoffeeTypeSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createCoffeeType(tx, {
        code: input.code,
        nameEn: input.nameEn,
        description: null,
        massBalanceTolerancePct: input.massBalanceTolerancePct ?? null,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/coffee')
  },
})

export const setCoffeeTypeActiveAction = withAction({
  name: 'masterData.setCoffeeTypeActive',
  permission: 'admin:manage_settings',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => setCoffeeTypeActive(tx, input.id, input.isActive, ctx.actor.userId))
    revalidatePath('/admin/coffee')
  },
})

// ── Coffee grade ─────────────────────────────────────────────────────────────

const createCoffeeGradeSchema = z.object({ code: codeSchema, nameEn: nameSchema })

export const createCoffeeGradeAction = withAction({
  name: 'masterData.createCoffeeGrade',
  permission: 'admin:manage_settings',
  schema: createCoffeeGradeSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createCoffeeGrade(tx, {
        code: input.code,
        nameEn: input.nameEn,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/coffee')
  },
})

export const setCoffeeGradeActiveAction = withAction({
  name: 'masterData.setCoffeeGradeActive',
  permission: 'admin:manage_settings',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => setCoffeeGradeActive(tx, input.id, input.isActive, ctx.actor.userId))
    revalidatePath('/admin/coffee')
  },
})

// ── Screen size ──────────────────────────────────────────────────────────────

const createScreenSizeSchema = z.object({ code: codeSchema, nameEn: nameSchema })

export const createScreenSizeAction = withAction({
  name: 'masterData.createScreenSize',
  permission: 'admin:manage_settings',
  schema: createScreenSizeSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createScreenSize(tx, {
        code: input.code,
        nameEn: input.nameEn,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/coffee')
  },
})

export const setScreenSizeActiveAction = withAction({
  name: 'masterData.setScreenSizeActive',
  permission: 'admin:manage_settings',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => setScreenSizeActive(tx, input.id, input.isActive, ctx.actor.userId))
    revalidatePath('/admin/coffee')
  },
})

// ── Certification ────────────────────────────────────────────────────────────

const createCertificationSchema = z.object({
  code: codeSchema,
  nameEn: nameSchema,
  issuingBody: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export const createCertificationAction = withAction({
  name: 'masterData.createCertification',
  permission: 'admin:manage_settings',
  schema: createCertificationSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createCertification(tx, {
        code: input.code,
        nameEn: input.nameEn,
        issuingBody: input.issuingBody ?? null,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/coffee')
  },
})

export const setCertificationActiveAction = withAction({
  name: 'masterData.setCertificationActive',
  permission: 'admin:manage_settings',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => setCertificationActive(tx, input.id, input.isActive, ctx.actor.userId))
    revalidatePath('/admin/coffee')
  },
})

// ── Harvest year ─────────────────────────────────────────────────────────────

const createHarvestYearSchema = z
  .object({
    code: codeSchema,
    nameEn: nameSchema,
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.'),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.'),
  })
  .refine((v) => v.endsOn > v.startsOn, {
    message: 'End date must be after the start date.',
    path: ['endsOn'],
  })

export const createHarvestYearAction = withAction({
  name: 'masterData.createHarvestYear',
  permission: 'admin:manage_settings',
  schema: createHarvestYearSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) =>
      createHarvestYear(tx, {
        code: input.code,
        nameEn: input.nameEn,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        actorId: ctx.actor.userId,
      }),
    )
    revalidatePath('/admin/coffee')
  },
})

export const setHarvestYearActiveAction = withAction({
  name: 'masterData.setHarvestYearActive',
  permission: 'admin:manage_settings',
  schema: toggleSchema,
  handler: async (input, ctx) => {
    await ctx.tx((tx) => setHarvestYearActive(tx, input.id, input.isActive, ctx.actor.userId))
    revalidatePath('/admin/coffee')
  },
})
