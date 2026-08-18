'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withPublicAction } from '@server/actions/with-action'
import { submitApplicantReply, recentReplyCount } from '@modules/onboarding'
import { verifyUpload } from '@modules/files'
import { env } from '@config/env'
import {
  AppError,
  RateLimitedError,
  ValidationError,
  type FieldError,
} from '@core/errors/app-error'
import { phone, tin, optionalUuid } from '../../shared-schema'
import { documentFieldName, DOCUMENT_FIELD_PREFIX } from '../../document-field'

/**
 * The applicant's reply to an info request — the second deliberately unauthenticated write in
 * the system, alongside `apply/actions.ts`. Same reasoning applies: `permission: 'public'`
 * makes the absence of an authorization check explicit rather than an omission, and a
 * possessed reference stands in for a login the same way it already does for the status page
 * itself.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal('').transform(() => undefined))

const schema = z.object({
  reference: z.string().trim().min(1),
  message: z.string().trim().min(5, 'Tell us what changed, even briefly.').max(1000),
  branchId: z.string().uuid('Choose which branch you would deliver to.').optional(),
  legalName: optionalText(200),
  tradeName: optionalText(200),
  businessTypeId: optionalUuid,
  tin,
  businessLicenceNo: optionalText(60),
  regionId: optionalUuid,
  city: z.string().trim().max(120).optional(),
  contactName: optionalText(150),
  contactPosition: optionalText(120),
  contactPhone: phone.optional().or(z.literal('').transform(() => undefined)),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address.')
    .max(200)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  expectedAnnualVolumeKg: z
    .string()
    .trim()
    .regex(/^[0-9]+(\.[0-9]{1,3})?$/, 'Enter a number of kilograms.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  primaryCoffeeTypeId: optionalUuid,
  intendedServices: optionalText(1000),
})

/** Max replies one application's thread may receive in a day. */
const DAILY_LIMIT = 5

async function extractDocuments(
  raw: unknown,
): Promise<Array<{ documentTypeId: string; filename: string; content: Buffer }>> {
  if (!(raw instanceof FormData)) return []

  const documents: Array<{ documentTypeId: string; filename: string; content: Buffer }> = []
  for (const [key, value] of raw.entries()) {
    if (!key.startsWith(DOCUMENT_FIELD_PREFIX)) continue
    if (!(value instanceof File) || value.size === 0) continue

    documents.push({
      documentTypeId: key.slice(DOCUMENT_FIELD_PREFIX.length),
      filename: value.name,
      content: Buffer.from(await value.arrayBuffer()),
    })
  }
  return documents
}

async function validateDocuments(
  documents: ReadonlyArray<{ documentTypeId: string; filename: string; content: Buffer }>,
): Promise<FieldError[]> {
  const fieldErrors: FieldError[] = []

  for (const doc of documents) {
    try {
      verifyUpload(doc.filename, doc.content, env.UPLOAD_MAX_BYTES)
    } catch (error) {
      const message =
        error instanceof AppError
          ? (error.fieldErrors?.[0]?.message ?? error.message)
          : 'Could not read this file.'
      fieldErrors.push({
        path: documentFieldName(doc.documentTypeId),
        code: 'invalid_file',
        message,
      })
    }
  }

  return fieldErrors
}

export const submitReplyAction = withPublicAction({
  name: 'onboarding.submitApplicantReply',
  permission: 'public',
  schema,
  handler: async (input, ctx) => {
    const recent = await recentReplyCount(input.reference)
    if (recent >= DAILY_LIMIT) {
      throw new RateLimitedError(60 * 60, {
        message:
          'Too many replies on this application today. Contact the branch if it is urgent.',
      })
    }

    const documents = await extractDocuments(ctx.raw)
    const fieldErrors = await validateDocuments(documents)
    if (fieldErrors.length > 0) {
      throw new ValidationError({ fieldErrors })
    }

    await submitApplicantReply({ ...input, documents })
    revalidatePath(`/apply/status/${encodeURIComponent(input.reference)}`)
  },
})
