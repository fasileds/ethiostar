import { describe, it, expect } from 'vitest'
import {
  evaluateChecklist,
  assertMayApprove,
  assertRejectionComment,
  documentsExpiringWithin,
  type RequiredDocument,
  type SubmittedDocument,
} from './kyc-checklist'
import { businessDate } from '@core/utils/date'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

const TODAY = businessDate('2026-08-12')

const required = (code: string, mandatory = true, hasExpiry = false): RequiredDocument => ({
  documentTypeId: `type-${code}`,
  documentTypeCode: code,
  documentTypeName: code.replace(/_/g, ' ').toLowerCase(),
  isMandatory: mandatory,
  hasExpiry,
})

const submitted = (
  code: string,
  overrides: Partial<SubmittedDocument> = {},
): SubmittedDocument => ({
  documentTypeId: `type-${code}`,
  fileId: `file-${code}`,
  verificationStatus: 'VERIFIED',
  scanStatus: 'CLEAN',
  expiresOn: null,
  rejectionReason: null,
  ...overrides,
})

const CHECKLIST = [
  required('TRADE_LICENCE', true, true),
  required('TIN_CERTIFICATE', true, false),
  required('EXPORT_LICENCE', false, true),
]

describe('evaluateChecklist — the M08 key control', () => {
  it('is satisfied when every mandatory document is verified and current', () => {
    const result = evaluateChecklist(
      CHECKLIST,
      [
        submitted('TRADE_LICENCE', { expiresOn: businessDate('2027-01-01') }),
        submitted('TIN_CERTIFICATE'),
      ],
      TODAY,
    )
    expect(result.satisfied).toBe(true)
    expect(result.blockingIssues).toEqual([])
  })

  it('blocks on a MISSING mandatory document', () => {
    const result = evaluateChecklist(CHECKLIST, [submitted('TIN_CERTIFICATE')], TODAY)
    expect(result.satisfied).toBe(false)
    expect(result.blockingIssues.map((i) => i.issue)).toEqual(['MISSING'])
  })

  it('blocks on an UNVERIFIED mandatory document', () => {
    const result = evaluateChecklist(
      CHECKLIST,
      [
        submitted('TRADE_LICENCE', {
          verificationStatus: 'PENDING',
          expiresOn: businessDate('2027-01-01'),
        }),
        submitted('TIN_CERTIFICATE'),
      ],
      TODAY,
    )
    expect(result.satisfied).toBe(false)
    expect(result.blockingIssues[0]!.issue).toBe('UNVERIFIED')
  })

  it('does NOT block an EXPIRED document if it has been VERIFIED by a reviewer', () => {
    // A reviewer has explicitly accepted the document; expiry is not re-checked at approval.
    const result = evaluateChecklist(
      CHECKLIST,
      [
        submitted('TRADE_LICENCE', { verificationStatus: 'VERIFIED', expiresOn: businessDate('2020-01-01') }),
        submitted('TIN_CERTIFICATE'),
      ],
      TODAY,
    )
    expect(result.satisfied).toBe(true)
    expect(result.blockingIssues).toEqual([])
  })

  it('accepts a VERIFIED document even if its expiry date is missing or lapsed', () => {
    // The reviewer has explicitly accepted the document, so expiry is not re-checked.
    const result = evaluateChecklist(
      CHECKLIST,
      [
        submitted('TRADE_LICENCE', { verificationStatus: 'VERIFIED', expiresOn: null }),
        submitted('TIN_CERTIFICATE'),
      ],
      TODAY,
    )
    expect(result.satisfied).toBe(true)
    expect(result.blockingIssues).toEqual([])
  })

  it('accepts a document expiring TODAY — it has not lapsed yet', () => {
    const result = evaluateChecklist(
      CHECKLIST,
      [submitted('TRADE_LICENCE', { expiresOn: TODAY }), submitted('TIN_CERTIFICATE')],
      TODAY,
    )
    expect(result.satisfied).toBe(true)
  })

  it('does NOT block a VERIFIED document even if expiry date is missing or lapsed', () => {
    // Once a reviewer marks a document VERIFIED, approval should not be blocked
    // by a missing or expired date — the reviewer's verdict is trusted.
    const result = evaluateChecklist(
      CHECKLIST,
      [submitted('TRADE_LICENCE', { verificationStatus: 'VERIFIED', expiresOn: null }), submitted('TIN_CERTIFICATE')],
      TODAY,
    )
    expect(result.satisfied).toBe(true)
    expect(result.blockingIssues).toEqual([])
  })

  it('blocks on a REJECTED document and surfaces the reviewer’s reason', () => {
    const result = evaluateChecklist(
      CHECKLIST,
      [
        submitted('TRADE_LICENCE', {
          verificationStatus: 'REJECTED',
          rejectionReason: 'The scan is illegible.',
          expiresOn: businessDate('2027-01-01'),
        }),
        submitted('TIN_CERTIFICATE'),
      ],
      TODAY,
    )
    expect(result.blockingIssues[0]!.issue).toBe('REJECTED')
    expect(result.blockingIssues[0]!.detail).toBe('The scan is illegible.')
  })

  /** A file that has not been scanned clean cannot satisfy a requirement. */
  it('blocks on a file that has not completed virus scanning', () => {
    const result = evaluateChecklist(
      CHECKLIST,
      [
        submitted('TRADE_LICENCE', {
          scanStatus: 'PENDING',
          expiresOn: businessDate('2027-01-01'),
        }),
        submitted('TIN_CERTIFICATE'),
      ],
      TODAY,
    )
    expect(result.blockingIssues.map((i) => i.issue)).toContain('NOT_SCANNED')
  })

  it('blocks outright on an INFECTED file and reports nothing else about it', () => {
    const result = evaluateChecklist(
      CHECKLIST,
      [
        submitted('TRADE_LICENCE', {
          scanStatus: 'INFECTED',
          verificationStatus: 'PENDING',
          expiresOn: null,
        }),
        submitted('TIN_CERTIFICATE'),
      ],
      TODAY,
    )
    const licence = result.blockingIssues.filter((i) => i.documentTypeCode === 'TRADE_LICENCE')
    expect(licence).toHaveLength(1)
    expect(licence[0]!.issue).toBe('INFECTED')
  })

  it('reports optional-document UNVERIFIED problems as ADVISORY, not blocking', () => {
    // Optional docs with issues appear as advisory. With new rule, an unverified
    // optional doc still shows UNVERIFIED in advisory.
    const result = evaluateChecklist(
      CHECKLIST,
      [
        submitted('TRADE_LICENCE', { expiresOn: businessDate('2027-01-01') }),
        submitted('TIN_CERTIFICATE'),
        submitted('EXPORT_LICENCE', { verificationStatus: 'PENDING', expiresOn: businessDate('2026-01-01') }),
      ],
      TODAY,
    )
    expect(result.satisfied).toBe(true)
    expect(result.advisoryIssues.some((i) => i.issue === 'UNVERIFIED')).toBe(true)
  })

  /** One message to the applicant, not three rounds of email. */
  it('reports EVERY blocking issue at once', () => {
    const result = evaluateChecklist(CHECKLIST, [], TODAY)
    expect(result.blockingIssues).toHaveLength(2)
    expect(result.blockingIssues.map((i) => i.documentTypeCode)).toEqual([
      'TRADE_LICENCE',
      'TIN_CERTIFICATE',
    ])
  })
})

describe('assertMayApprove — "An application cannot be approved while any mandatory document is unverified or expired"', () => {
  it('permits approval when the checklist is satisfied', () => {
    expect(() =>
      assertMayApprove(
        CHECKLIST,
        [
          submitted('TRADE_LICENCE', { expiresOn: businessDate('2027-01-01') }),
          submitted('TIN_CERTIFICATE'),
        ],
        TODAY,
      ),
    ).not.toThrow()
  })

  it('REFUSES approval with an unverified document', () => {
    try {
      assertMayApprove(
        CHECKLIST,
        [
          submitted('TRADE_LICENCE', {
            verificationStatus: 'PENDING',
            expiresOn: businessDate('2027-01-01'),
          }),
          submitted('TIN_CERTIFICATE'),
        ],
        TODAY,
      )
      expect.unreachable('approval must be refused')
    } catch (error) {
      const e = error as BusinessRuleViolation
      expect(e.code).toBe(ERROR_CODES.MANDATORY_DOCUMENT_UNVERIFIED)
      expect(Array.isArray(e.details?.issues)).toBe(true)
    }
  })

  it('reports DOCUMENT_EXPIRED when a PENDING document has a lapsed expiry', () => {
    try {
      assertMayApprove(
        CHECKLIST,
        [
          // PENDING so expiry check still runs; VERIFIED would skip expiry check
          submitted('TRADE_LICENCE', { verificationStatus: 'PENDING', expiresOn: businessDate('2026-08-01') }),
          submitted('TIN_CERTIFICATE'),
        ],
        TODAY,
      )
      expect.unreachable()
    } catch (error) {
      expect((error as BusinessRuleViolation).code).toBe(ERROR_CODES.DOCUMENT_EXPIRED)
    }
  })

  it('permits approval when a VERIFIED document has a lapsed expiry (reviewer overrides)', () => {
    expect(() =>
      assertMayApprove(
        CHECKLIST,
        [
          submitted('TRADE_LICENCE', { verificationStatus: 'VERIFIED', expiresOn: businessDate('2020-01-01') }),
          submitted('TIN_CERTIFICATE'),
        ],
        TODAY,
      ),
    ).not.toThrow()
  })
})

describe('documentsExpiringWithin — the reminder job', () => {
  const doc = (code: string, expiresOn: string, warningDays: number) => ({
    ...submitted(code, { expiresOn: businessDate(expiresOn) }),
    documentTypeCode: code,
    warningDays,
  })

  it('flags a document inside its warning window', () => {
    const expiring = documentsExpiringWithin([doc('TRADE_LICENCE', '2026-09-01', 30)], TODAY)
    expect(expiring).toHaveLength(1)
    expect(expiring[0]!.daysRemaining).toBe(20)
  })

  it('ignores a document outside its warning window', () => {
    expect(documentsExpiringWithin([doc('TRADE_LICENCE', '2026-12-01', 30)], TODAY)).toEqual([])
  })

  it('flags a document that has ALREADY expired — a negative remainder', () => {
    const expiring = documentsExpiringWithin([doc('TRADE_LICENCE', '2026-08-01', 30)], TODAY)
    expect(expiring[0]!.daysRemaining).toBe(-11)
  })

  it('honours a per-document-type warning period', () => {
    expect(documentsExpiringWithin([doc('EXPORT_LICENCE', '2026-09-01', 7)], TODAY)).toEqual([])
    expect(
      documentsExpiringWithin([doc('EXPORT_LICENCE', '2026-09-01', 60)], TODAY),
    ).toHaveLength(1)
  })

  it('ignores documents with no expiry', () => {
    expect(
      documentsExpiringWithin(
        [
          {
            ...submitted('TIN_CERTIFICATE'),
            documentTypeCode: 'TIN_CERTIFICATE',
            warningDays: 30,
          },
        ],
        TODAY,
      ),
    ).toEqual([])
  })
})

describe('assertRejectionComment — the requester must know what to fix', () => {
  it('rejects an empty or token comment', () => {
    expect(() => assertRejectionComment(null)).toThrow(BusinessRuleViolation)
    expect(() => assertRejectionComment('   ')).toThrow(BusinessRuleViolation)
    expect(() => assertRejectionComment('no')).toThrow(BusinessRuleViolation)
  })

  it('accepts a real explanation', () => {
    expect(() =>
      assertRejectionComment(
        'The trade licence scan is illegible; please resubmit a clear copy.',
      ),
    ).not.toThrow()
  })
})
