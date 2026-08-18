'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { withPublicAction } from '@server/actions/with-action'
import {
  submitPublicApplication,
  publicKycRequirements,
  recentSubmissionCount,
} from '@modules/onboarding'
import { verifyUpload } from '@modules/files'
import { env } from '@config/env'
import {
  AppError,
  RateLimitedError,
  ValidationError,
  type FieldError,
} from '@core/errors/app-error'
import { documentFieldName, DOCUMENT_FIELD_PREFIX } from './document-field'
import {
  phone,
  optionalUuid,
  legalName,
  tradeName,
  tin,
  businessLicenceNo,
  contactName,
  contactPosition,
  contactEmail,
  intendedServices,
} from './shared-schema'

/**
 * The public application submit.
 *
 * `withPublicAction` makes the absence of an authorization check explicit and greppable —
 * this is the one deliberately unauthenticated write in the system, and it should be
 * findable as such rather than looking like an omission.
 *
 * Everything an applicant sends is re-validated by staff at review. Nothing downstream trusts
 * a value that arrived here.
 */

const schema = z.object({
  branchId: z.string().uuid('Choose which branch you would deliver to.'),
  legalName,
  tradeName,
  businessTypeId: optionalUuid,
  tin,
  businessLicenceNo,
  regionId: optionalUuid,
  city: z.string().trim().max(120).optional(),
  contactName,
  contactPosition,
  contactPhone: phone,
  contactEmail,
  expectedAnnualVolumeKg: z
    .string()
    .trim()
    .regex(/^[0-9]+(\.[0-9]{1,3})?$/, 'Enter a number of kilograms.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  primaryCoffeeTypeId: optionalUuid,
  intendedServices,
})

/** Max applications one email address may submit in a day. */
const DAILY_LIMIT = 3

/**
 * Pull the KYC files out of the raw submission.
 *
 * They cannot be named fields on `schema` — which document types apply depends on the
 * business type the applicant just chose, so the schema can't know their field names in
 * advance. `ApplyForm` names each file input `doc_<documentTypeId>` (see `document-field.ts`);
 * this reads that convention back out of the FormData `withPublicAction` already parsed.
 */
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

/**
 * Verified here, before anything is written, so a bad file fails the submission cleanly and
 * highlights the exact field — `verifyUpload` itself always reports path `file`, which means
 * nothing on a form with several dynamically named file inputs.
 */
async function validateDocuments(
  documents: ReadonlyArray<{ documentTypeId: string; filename: string; content: Buffer }>,
  businessTypeId: string | undefined,
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

  if (businessTypeId) {
    const requirements = (await publicKycRequirements()).filter(
      (r) => r.businessTypeId === businessTypeId,
    )
    const supplied = new Set(documents.map((d) => d.documentTypeId))
    for (const requirement of requirements) {
      if (requirement.isMandatory && !supplied.has(requirement.documentTypeId)) {
        fieldErrors.push({
          path: documentFieldName(requirement.documentTypeId),
          code: 'required',
          message: `${requirement.name} is required.`,
        })
      }
    }
  }

  return fieldErrors
}

export const submitApplicationAction = withPublicAction({
  name: 'onboarding.submitPublicApplication',
  permission: 'public',
  schema,
  handler: async (input, ctx) => {
    // Rate limit on the contact address rather than on IP. Applicants in Ethiopia frequently
    // share a NAT or an internet cafe, so an IP limit would refuse legitimate cooperatives
    // while barely inconveniencing anyone determined.
    const recent = await recentSubmissionCount(input.contactEmail)
    if (recent >= DAILY_LIMIT) {
      throw new RateLimitedError(60 * 60, {
        message:
          'This email address has already submitted several applications today. If you need to correct one, quote its reference and contact the branch.',
      })
    }

    const forwarded = (await headers()).get('x-forwarded-for')
    const submittedIp = forwarded?.split(',')[0]?.trim()

    if (input.legalName.toLowerCase() === input.contactName.toLowerCase()) {
      // Not fatal, but almost always a mis-filled form — the business name and the person are
      // different things, and catching it here saves a review cycle.
      throw new ValidationError({
        fieldErrors: [
          {
            path: 'legalName',
            code: 'custom',
            message:
              'The business name and the contact name are the same. Enter the registered business name here.',
          },
        ],
      })
    }

    const documents = await extractDocuments(ctx.raw)
    const fieldErrors = await validateDocuments(documents, input.businessTypeId)
    if (fieldErrors.length > 0) {
      throw new ValidationError({ fieldErrors })
    }

    const { reference } = await submitPublicApplication({
      ...input,
      ...(submittedIp ? { submittedIp } : {}),
      documents,
    })

    return { reference }
  },
})
