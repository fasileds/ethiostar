import { z } from 'zod'

/**
 * Field-level Zod validators shared between the initial public application form
 * (`apply/actions.ts`) and the applicant's later self-service reply
 * (`apply/status/[reference]/actions.ts`) — both are unauthenticated writes to the same
 * columns, so the same rules (and the same permissive-on-purpose Ethiopian phone regex)
 * must apply to a correction as applied to the original submission.
 */

export const phone = z
  .string()
  .trim()
  .min(9, 'Enter a phone number we can reach you on.')
  .max(20)
  // Deliberately permissive: Ethiopian numbers are written +251…, 09…, and with spaces and
  // hyphens in between. Rejecting a real number to enforce a format is worse than storing a
  // format we have to normalise later.
  .regex(/^[+0-9][0-9\s-]+$/, 'Use digits, spaces and hyphens only.')

export const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal('').transform(() => undefined))

export const legalName = z
  .string()
  .trim()
  .min(2, 'Enter your registered business name.')
  .max(200)
export const tradeName = z.string().trim().max(200).optional()
export const tin = z
  .string()
  .trim()
  .regex(/^[0-9]{10}$/, 'An Ethiopian TIN is 10 digits.')
  .optional()
  .or(z.literal('').transform(() => undefined))
export const businessLicenceNo = z.string().trim().max(60).optional()
export const contactName = z.string().trim().min(2, 'Who should we speak to?').max(150)
export const contactPosition = z.string().trim().max(120).optional()
export const contactEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(200)
export const intendedServices = z.string().trim().max(1000).optional()
