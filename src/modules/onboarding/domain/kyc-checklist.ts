import type { BusinessDate } from '@core/utils/date'
import { isBusinessDateBefore } from '@core/utils/date'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

/**
 * M08 — KYC document verification.
 *
 * THE KEY CONTROL, verbatim: "An application cannot be approved while any mandatory
 * document is unverified or expired."
 *
 * The checklist itself is DATA (`kyc_document_requirement`), configurable per business
 * type, so EthioStar changes what is mandatory without a release.
 */

export type DocumentVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED'
export type FileScanStatus = 'PENDING' | 'CLEAN' | 'INFECTED' | 'ERROR'

export interface RequiredDocument {
  readonly documentTypeId: string
  readonly documentTypeCode: string
  readonly documentTypeName: string
  readonly isMandatory: boolean
  readonly hasExpiry: boolean
}

export interface SubmittedDocument {
  readonly documentTypeId: string
  readonly fileId: string
  readonly verificationStatus: DocumentVerificationStatus
  /** A file that has not been scanned clean cannot satisfy a requirement. */
  readonly scanStatus: FileScanStatus
  readonly expiresOn: BusinessDate | null
  readonly rejectionReason: string | null
}

export type ChecklistIssueCode =
  | 'MISSING'
  | 'UNVERIFIED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'NO_EXPIRY_RECORDED'
  | 'NOT_SCANNED'
  | 'INFECTED'

export interface ChecklistIssue {
  readonly documentTypeCode: string
  readonly documentTypeName: string
  readonly issue: ChecklistIssueCode
  readonly detail: string
}

export interface ChecklistResult {
  readonly satisfied: boolean
  /** Issues on MANDATORY documents — these block approval. */
  readonly blockingIssues: readonly ChecklistIssue[]
  /** Issues on optional documents — worth showing, but they do not block. */
  readonly advisoryIssues: readonly ChecklistIssue[]
}

/**
 * Evaluate the checklist as of a given date.
 *
 * `asOf` is passed in rather than read from a clock so the evaluation is deterministic and
 * so an approval decision can be re-evaluated exactly as it stood on the day it was made.
 */
export function evaluateChecklist(
  required: readonly RequiredDocument[],
  submitted: readonly SubmittedDocument[],
  asOf: BusinessDate,
): ChecklistResult {
  const byType = new Map(submitted.map((doc) => [doc.documentTypeId, doc]))
  const blocking: ChecklistIssue[] = []
  const advisory: ChecklistIssue[] = []

  for (const requirement of required) {
    const issues = issuesFor(requirement, byType.get(requirement.documentTypeId), asOf)
    for (const issue of issues) {
      if (requirement.isMandatory) blocking.push(issue)
      else advisory.push(issue)
    }
  }

  return {
    satisfied: blocking.length === 0,
    blockingIssues: blocking,
    advisoryIssues: advisory,
  }
}

type IssueBase = { documentTypeCode: string; documentTypeName: string }

/** Scan status gates everything: an unscanned or infected file satisfies nothing. */
function scanIssues(base: IssueBase, document: SubmittedDocument): ChecklistIssue[] {
  if (document.scanStatus === 'INFECTED') {
    return [
      {
        ...base,
        issue: 'INFECTED',
        detail: `${base.documentTypeName} failed the virus scan and cannot be accepted.`,
      },
    ]
  }

  if (document.scanStatus !== 'CLEAN') {
    return [
      {
        ...base,
        issue: 'NOT_SCANNED',
        detail: `${base.documentTypeName} has not completed virus scanning.`,
      },
    ]
  }

  return []
}

function verificationIssues(base: IssueBase, document: SubmittedDocument): ChecklistIssue[] {
  if (document.verificationStatus === 'REJECTED') {
    return [
      {
        ...base,
        issue: 'REJECTED',
        detail: document.rejectionReason ?? `${base.documentTypeName} was rejected on review.`,
      },
    ]
  }

  if (document.verificationStatus !== 'VERIFIED') {
    return [
      {
        ...base,
        issue: 'UNVERIFIED',
        detail: `${base.documentTypeName} has not been verified.`,
      },
    ]
  }

  return []
}

function expiryIssues(
  base: IssueBase,
  document: SubmittedDocument,
  asOf: BusinessDate,
): ChecklistIssue[] {
  if (document.expiresOn === null) {
    return [
      {
        ...base,
        issue: 'NO_EXPIRY_RECORDED',
        detail: `${base.documentTypeName} requires an expiry date.`,
      },
    ]
  }

  if (isBusinessDateBefore(document.expiresOn, asOf)) {
    return [
      {
        ...base,
        issue: 'EXPIRED',
        detail: `${base.documentTypeName} expired on ${document.expiresOn}.`,
      },
    ]
  }

  return []
}

function issuesFor(
  requirement: RequiredDocument,
  document: SubmittedDocument | undefined,
  asOf: BusinessDate,
): ChecklistIssue[] {
  const base: IssueBase = {
    documentTypeCode: requirement.documentTypeCode,
    documentTypeName: requirement.documentTypeName,
  }

  if (!document) {
    return [
      {
        ...base,
        issue: 'MISSING',
        detail: `${requirement.documentTypeName} has not been submitted.`,
      },
    ]
  }

  // An infected file short-circuits: nothing else about it is worth reporting.
  const scan = scanIssues(base, document)
  if (scan.some((i) => i.issue === 'INFECTED')) return scan

  const verification = verificationIssues(base, document)
  // A rejected document short-circuits too — fix the rejection first.
  if (verification.some((i) => i.issue === 'REJECTED')) return [...scan, ...verification]

  // If a reviewer has already explicitly verified the document, trust that verdict:
  // skip expiry checks so a missing or lapsed expiry date does not block approval
  // after the document has been reviewed and accepted.
  const isVerified = document.verificationStatus === 'VERIFIED'
  const expiry = requirement.hasExpiry && !isVerified ? expiryIssues(base, document, asOf) : []

  return [...scan, ...verification, ...expiry]
}

/**
 * THE M08 KEY CONTROL, as a guard on approval.
 *
 * Throws with EVERY blocking issue listed, so the Customer Service Officer can tell the
 * applicant everything that is wrong in one message rather than three rounds of email.
 */
export function assertMayApprove(
  required: readonly RequiredDocument[],
  submitted: readonly SubmittedDocument[],
  asOf: BusinessDate,
): void {
  const result = evaluateChecklist(required, submitted, asOf)
  if (result.satisfied) return

  const anyExpired = result.blockingIssues.some((i) => i.issue === 'EXPIRED')

  throw new BusinessRuleViolation(
    anyExpired ? ERROR_CODES.DOCUMENT_EXPIRED : ERROR_CODES.MANDATORY_DOCUMENT_UNVERIFIED,
    {
      message:
        'This application cannot be approved while a mandatory document is missing, unverified or expired.',
      details: {
        issues: result.blockingIssues.map((i) => ({
          documentType: i.documentTypeCode,
          issue: i.issue,
          detail: i.detail,
        })),
      },
    },
  )
}

/**
 * Documents approaching expiry, for the reminder job.
 *
 * "automatic reminders at configurable intervals before a customer document expires, and a
 * block on new requests once a mandatory document has lapsed."
 */
export function documentsExpiringWithin(
  documents: ReadonlyArray<
    SubmittedDocument & { warningDays: number; documentTypeCode: string }
  >,
  asOf: BusinessDate,
): Array<{ documentTypeCode: string; expiresOn: BusinessDate; daysRemaining: number }> {
  const asOfMs = Date.parse(`${asOf}T00:00:00.000Z`)

  return documents
    .filter((doc) => doc.expiresOn !== null)
    .map((doc) => {
      const expiresOn = doc.expiresOn as BusinessDate
      const daysRemaining = Math.round(
        (Date.parse(`${expiresOn}T00:00:00.000Z`) - asOfMs) / 86_400_000,
      )
      return {
        documentTypeCode: doc.documentTypeCode,
        expiresOn,
        daysRemaining,
        warningDays: doc.warningDays,
      }
    })
    .filter((doc) => doc.daysRemaining <= doc.warningDays)
    .map(({ documentTypeCode, expiresOn, daysRemaining }) => ({
      documentTypeCode,
      expiresOn,
      daysRemaining,
    }))
}

/**
 * A rejection MUST carry a comment.
 *
 * M03's phrasing — "with mandatory comment on rejection or return, so the requester always
 * knows what to fix" — is a Phase 2 module, but the rule is plainly correct now and costs
 * nothing to enforce.
 */
export function assertRejectionComment(comment: string | null): void {
  if (!comment || comment.trim().length < 10) {
    throw new BusinessRuleViolation(ERROR_CODES.REJECTION_COMMENT_REQUIRED, {
      message: 'A rejection must explain what the applicant needs to fix.',
    })
  }
}
