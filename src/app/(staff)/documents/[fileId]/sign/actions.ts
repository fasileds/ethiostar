'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { captureSignature } from '@modules/files'

/**
 * The general-purpose signing entry point — any file, any source. Other Phase-2 modules
 * (contracts, billing) link here rather than building their own capture flow; see
 * `src/modules/files/application/sign-document.ts` for the staff-only scope this is built to.
 */

const schema = z.object({
  fileId: z.string().uuid(),
  sourceType: z.string().trim().min(1).max(60),
  sourceId: z.string().uuid(),
  signerName: z.string().trim().min(2, 'Enter the signer’s name.').max(150),
  signerRole: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  method: z.enum(['DRAWN', 'TYPED', 'CLICK']),
  signatureData: z
    .string()
    .max(200000)
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export const captureSignatureAction = withAction({
  name: 'files.captureSignature',
  permission: 'document:sign',
  schema,
  handler: async (input, ctx) => {
    const headerList = await headers()
    const forwarded = headerList.get('x-forwarded-for')
    const ipAddress = forwarded?.split(',')[0]?.trim() ?? null
    const userAgent = headerList.get('user-agent')

    const result = await captureSignature(ctx.claims, {
      fileId: input.fileId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      signerUserId: null,
      signerName: input.signerName,
      signerRole: input.signerRole ?? null,
      method: input.method,
      signatureData: input.signatureData ?? null,
      ipAddress,
      userAgent,
      actorId: ctx.actor.userId,
    })

    revalidatePath(`/documents/${input.fileId}/sign`)
    return result
  },
})
