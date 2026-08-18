'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import {
  startReview,
  attachApplicationDocument,
  verifyApplicationDocument,
  requestApplicationInfo,
  postApplicationMessage,
  rejectApplication,
  approveApplication,
} from '@modules/onboarding'

/**
 * M08 review actions.
 *
 * Every action re-fetches the detail page after it runs — `revalidatePath` rather than
 * `router.refresh()`, because the reviewer is very often not the only person acting on this
 * application (a colleague may have just verified a document), and a stale client cache
 * showing an already-superseded state is how two people approve the same application.
 */

const idSchema = z.object({ applicationId: z.string().uuid() })

export const startReviewAction = withAction({
  name: 'onboarding.startReview',
  permission: 'customer_application:review',
  schema: idSchema,
  handler: async ({ applicationId }, ctx) => {
    await startReview(ctx.claims, applicationId, ctx.actor.userId)
    revalidatePath(`/applications/${applicationId}`)
  },
})

const attachSchema = z.object({
  applicationId: z.string().uuid(),
  documentTypeId: z.string().uuid(),
  documentNumber: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  issuedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  file: z.instanceof(File),
})

export const attachDocumentAction = withAction({
  name: 'onboarding.attachApplicationDocument',
  permission: 'customer_application:verify_document',
  schema: attachSchema,
  handler: async (input, ctx) => {
    const content = Buffer.from(await input.file.arrayBuffer())

    await attachApplicationDocument(ctx.claims, {
      applicationId: input.applicationId,
      documentTypeId: input.documentTypeId,
      filename: input.file.name,
      content,
      documentNumber: input.documentNumber ?? null,
      issuedOn: input.issuedOn ?? null,
      expiresOn: input.expiresOn ?? null,
      actorId: ctx.actor.userId,
    })

    revalidatePath(`/applications/${input.applicationId}`)
  },
})

const verifySchema = z.object({
  applicationId: z.string().uuid(),
  documentId: z.string().uuid(),
  verdict: z.enum(['VERIFIED', 'REJECTED']),
  rejectionReason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  documentNumber: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export const verifyDocumentAction = withAction({
  name: 'onboarding.verifyApplicationDocument',
  permission: 'customer_application:verify_document',
  schema: verifySchema,
  handler: async (input, ctx) => {
    await verifyApplicationDocument(
      ctx.claims,
      input.documentId,
      input.verdict,
      ctx.actor.userId,
      input.rejectionReason ?? null,
      input.documentNumber ?? null,
      input.expiresOn ?? null,
    )
    revalidatePath(`/applications/${input.applicationId}`)
  },
})

const infoSchema = z.object({
  applicationId: z.string().uuid(),
  note: z.string().trim().min(10, 'Explain what is still needed.').max(1000),
})

export const requestInfoAction = withAction({
  name: 'onboarding.requestApplicationInfo',
  permission: 'customer_application:review',
  schema: infoSchema,
  handler: async (input, ctx) => {
    await requestApplicationInfo(ctx.claims, {
      applicationId: input.applicationId,
      note: input.note,
      actorId: ctx.actor.userId,
    })
    revalidatePath(`/applications/${input.applicationId}`)
  },
})

const messageSchema = z.object({
  applicationId: z.string().uuid(),
  body: z.string().trim().min(1, 'Write a reply.').max(1000),
})

export const postMessageAction = withAction({
  name: 'onboarding.postApplicationMessage',
  permission: 'customer_application:message',
  schema: messageSchema,
  handler: async (input, ctx) => {
    await postApplicationMessage(ctx.claims, {
      applicationId: input.applicationId,
      body: input.body,
      actorId: ctx.actor.userId,
    })
    revalidatePath(`/applications/${input.applicationId}`)
  },
})

const rejectSchema = z.object({
  applicationId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Explain what the applicant needs to fix.').max(1000),
})

export const rejectApplicationAction = withAction({
  name: 'onboarding.rejectApplication',
  permission: 'customer_application:reject',
  schema: rejectSchema,
  handler: async (input, ctx) => {
    await rejectApplication(ctx.claims, {
      applicationId: input.applicationId,
      reason: input.reason,
      actorId: ctx.actor.userId,
    })
    revalidatePath(`/applications/${input.applicationId}`)
    revalidatePath('/applications')
  },
})

export const approveApplicationAction = withAction({
  name: 'onboarding.approveApplication',
  permission: 'customer_application:approve',
  schema: idSchema,
  handler: async ({ applicationId }, ctx) => {
    const result = await approveApplication(ctx.claims, applicationId, ctx.actor.userId)
    revalidatePath(`/applications/${applicationId}`)
    revalidatePath('/applications')
    revalidatePath('/customers')
    return result
  },
})
