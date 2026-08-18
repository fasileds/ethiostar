import 'server-only'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { toBusinessDate, type BusinessDate } from '@core/utils/date'
import { systemClock } from '@core/clock/clock'
import { uploadFile } from '@modules/files'
import { provisionAuthUser, assignRole, ROLE_CODES } from '@modules/identity'
import { queueNotification, NOTIFICATION_TEMPLATES } from '@modules/notification'
import {
  assertMayApprove,
  assertRejectionComment,
  type RequiredDocument,
  type SubmittedDocument,
} from '../domain/kyc-checklist'
import {
  lockApplication,
  transitionApplication,
  setInfoRequested,
  setRejectionReason,
  linkApplicationToCustomer,
  upsertApplicationDocument,
  setDocumentVerification,
  insertApplicationMessage,
} from '../infrastructure/application.repository'
import { createCustomerFromApplication } from '../infrastructure/create-customer.repository'
import { applicationDocuments, type ApplicationDocumentRow } from './application.query'

/**
 * M08 review use cases.
 *
 * Every function here takes `claims` rather than an open `tx`, in the same two-phase shape
 * as `files.uploadFile`: nothing that performs I/O (a file scan, provisioning a login) may
 * run inside a transaction, so a use case that needs both opens more than one.
 */

function scanStatus(fileStatus: string | null): 'PENDING' | 'CLEAN' | 'INFECTED' | 'ERROR' {
  if (fileStatus === 'AVAILABLE') return 'CLEAN'
  if (fileStatus === 'QUARANTINED') return 'INFECTED'
  if (fileStatus === 'PENDING') return 'PENDING'
  return 'ERROR'
}

function toChecklistInputs(rows: readonly ApplicationDocumentRow[]): {
  required: RequiredDocument[]
  submitted: SubmittedDocument[]
} {
  const required = rows.map((row) => ({
    documentTypeId: row.documentTypeId,
    documentTypeCode: row.documentTypeCode,
    documentTypeName: row.documentTypeName,
    isMandatory: row.isMandatory,
    hasExpiry: row.hasExpiry,
  }))

  const submitted = rows
    .filter((row) => row.id && row.fileId)
    .map((row) => ({
      documentTypeId: row.documentTypeId,
      fileId: row.fileId as string,
      verificationStatus: (row.verificationStatus ??
        'PENDING') as SubmittedDocument['verificationStatus'],
      scanStatus: scanStatus(row.fileStatus),
      expiresOn: row.expiresOn as SubmittedDocument['expiresOn'],
      rejectionReason: row.rejectionReason,
    }))

  return { required, submitted }
}

export async function startReview(
  claims: DbClaims,
  applicationId: string,
  actorId: string,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const header = await lockApplication(tx, applicationId)
    await transitionApplication(tx, header.status, {
      id: applicationId,
      to: 'UNDER_REVIEW',
      actorId,
      byApplicant: false,
    })
  })
}

export interface AttachDocumentInput {
  readonly applicationId: string
  readonly documentTypeId: string
  readonly filename: string
  readonly content: Buffer
  readonly documentNumber?: string | null
  readonly issuedOn?: string | null
  readonly expiresOn?: string | null
  readonly actorId: string
}

/**
 * Attach a document a reviewer has received by another channel — email, in person, a
 * scanned copy — and is recording during review. The public application form does not yet
 * carry a document-upload step (Phase 1 gap: the multi-step wizard roadmap Step 14
 * describes is not built), so this is currently the only way a document reaches the file
 * store; it is written generally enough that a future applicant-facing upload can call the
 * same `files.uploadFile` + `upsertApplicationDocument` pair.
 */
export async function attachApplicationDocument(
  claims: DbClaims,
  input: AttachDocumentInput,
): Promise<{ fileId: string }> {
  const uploaded = await uploadFile(claims, {
    filename: input.filename,
    content: input.content,
    sourceType: 'customer_application',
    sourceId: input.applicationId,
    category: 'KYC_DOCUMENT',
    actorId: input.actorId,
  })

  await runInTransaction(claims, (tx) =>
    upsertApplicationDocument(tx, {
      applicationId: input.applicationId,
      documentTypeId: input.documentTypeId,
      fileId: uploaded.fileId,
      documentNumber: input.documentNumber ?? null,
      issuedOn: input.issuedOn ?? null,
      expiresOn: input.expiresOn ?? null,
      actorId: input.actorId,
    }),
  )

  return { fileId: uploaded.fileId }
}

export async function verifyApplicationDocument(
  claims: DbClaims,
  documentId: string,
  verdict: 'VERIFIED' | 'REJECTED',
  actorId: string,
  rejectionReason: string | null,
  documentNumber?: string | null,
  expiresOn?: string | null,
): Promise<void> {
  await runInTransaction(claims, (tx) =>
    setDocumentVerification(
      tx,
      documentId,
      verdict,
      actorId,
      rejectionReason,
      documentNumber,
      expiresOn,
    ),
  )
}

export interface RequestInfoInput {
  readonly applicationId: string
  readonly note: string
  readonly actorId: string
}

export async function requestApplicationInfo(
  claims: DbClaims,
  input: RequestInfoInput,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const header = await lockApplication(tx, input.applicationId)
    await transitionApplication(tx, header.status, {
      id: input.applicationId,
      to: 'INFO_REQUESTED',
      actorId: input.actorId,
      byApplicant: false,
      note: input.note,
    })
    await setInfoRequested(tx, input.applicationId, input.note)
    await insertApplicationMessage(tx, {
      applicationId: input.applicationId,
      senderKind: 'STAFF',
      senderUserId: input.actorId,
      body: input.note,
      actorId: input.actorId,
    })

    await queueNotification(tx, {
      templateCode: NOTIFICATION_TEMPLATES.APPLICATION_INFO_REQUESTED,
      recipientAddress: header.contactEmail,
      variables: {
        contactName: header.contactName,
        legalName: header.legalName,
        infoRequested: input.note,
        reference: header.reference,
      },
      sourceType: 'customer_application',
      sourceId: input.applicationId,
      actorId: input.actorId,
    })
  })
}

export interface PostMessageInput {
  readonly applicationId: string
  readonly body: string
  readonly actorId: string
}

/**
 * A lightweight reply on the thread — no status change, unlike `requestApplicationInfo`. For
 * when a reviewer wants to say something without formally reopening `INFO_REQUESTED`.
 */
export async function postApplicationMessage(
  claims: DbClaims,
  input: PostMessageInput,
): Promise<void> {
  await runInTransaction(claims, (tx) =>
    insertApplicationMessage(tx, {
      applicationId: input.applicationId,
      senderKind: 'STAFF',
      senderUserId: input.actorId,
      body: input.body,
      actorId: input.actorId,
    }),
  )
}

export interface RejectApplicationInput {
  readonly applicationId: string
  readonly reason: string
  readonly actorId: string
}

export async function rejectApplication(
  claims: DbClaims,
  input: RejectApplicationInput,
): Promise<void> {
  assertRejectionComment(input.reason)

  await runInTransaction(claims, async (tx) => {
    const header = await lockApplication(tx, input.applicationId)
    await transitionApplication(tx, header.status, {
      id: input.applicationId,
      to: 'REJECTED',
      actorId: input.actorId,
      byApplicant: false,
      note: input.reason,
    })
    await setRejectionReason(tx, input.applicationId, input.reason)

    await queueNotification(tx, {
      templateCode: NOTIFICATION_TEMPLATES.APPLICATION_REJECTED,
      recipientAddress: header.contactEmail,
      variables: {
        contactName: header.contactName,
        legalName: header.legalName,
        reason: input.reason,
        reference: header.reference,
      },
      sourceType: 'customer_application',
      sourceId: input.applicationId,
      actorId: input.actorId,
    })
  })
}

export interface ApproveApplicationResult {
  readonly customerId: string
  readonly customerCode: string
  readonly userId: string
}

interface ApprovalHeader {
  readonly contactEmail: string
  readonly contactName: string
  readonly legalName: string
}

async function createCustomerAndNotify(
  tx: Tx,
  applicationId: string,
  header: Awaited<ReturnType<typeof lockApplication>>,
  actorId: string,
  today: BusinessDate,
): Promise<{ customerId: string; customerCode: string }> {
  const { customerId, code } = await createCustomerFromApplication(tx, {
    applicationId,
    branchId: header.branchId,
    legalName: header.legalName,
    tradeName: null,
    businessTypeId: null,
    tin: null,
    businessLicenceNo: null,
    licenceExpiresOn: null,
    regionId: null,
    woredaId: null,
    contactName: header.contactName,
    contactPosition: null,
    contactPhone: header.contactPhone,
    contactEmail: header.contactEmail,
    actorId,
    onboardedOn: today,
  })

  await linkApplicationToCustomer(tx, applicationId, customerId)

  await queueNotification(tx, {
    templateCode: NOTIFICATION_TEMPLATES.APPLICATION_APPROVED,
    recipientAddress: header.contactEmail,
    variables: {
      contactName: header.contactName,
      legalName: header.legalName,
      customerCode: code,
      reference: header.reference,
    },
    sourceType: 'customer_application',
    sourceId: applicationId,
    actorId,
  })

  return { customerId, customerCode: code }
}

/** Phase 1: the key control, the transition, the customer row, the approval notice. */
async function approveAndCreateCustomer(
  claims: DbClaims,
  applicationId: string,
  actorId: string,
  today: BusinessDate,
): Promise<{ customerId: string; customerCode: string; header: ApprovalHeader }> {
  return runInTransaction(claims, async (tx) => {
    const header = await lockApplication(tx, applicationId)
    const rows = await applicationDocuments(tx, applicationId)
    const { required, submitted } = toChecklistInputs(rows)

    // THE KEY CONTROL: throws if any mandatory document is missing, unverified or expired.
    assertMayApprove(required, submitted, today)

    await transitionApplication(tx, header.status, {
      id: applicationId,
      to: 'APPROVED',
      actorId,
      byApplicant: false,
    })

    const { customerId, customerCode } = await createCustomerAndNotify(
      tx,
      applicationId,
      header,
      actorId,
      today,
    )

    return { customerId, customerCode, header }
  })
}

/**
 * Approve an application: THE M08 key control, then customer creation, then a login.
 *
 * THREE PHASES:
 *   1. tx (`approveAndCreateCustomer`) — assert the checklist, transition to APPROVED,
 *      create the customer, notify.
 *   2. I/O — provision the GoTrue user (cannot run inside a transaction).
 *   3. tx — assign the CUSTOMER role, queue the credential email.
 *
 * If phase 2 or 3 fails, the application is left APPROVED with a customer but no login —
 * recoverable by re-running phases 2–3 (no such retry action exists yet; noted as a gap).
 */
export async function approveApplication(
  claims: DbClaims,
  applicationId: string,
  actorId: string,
): Promise<ApproveApplicationResult> {
  const today = toBusinessDate(systemClock.now())

  const phase1 = await approveAndCreateCustomer(claims, applicationId, actorId, today)

  const provisioned = await provisionAuthUser({
    email: phase1.header.contactEmail,
    fullName: phase1.header.contactName,
    actorKind: 'customer',
    customerId: phase1.customerId,
    createdBy: actorId,
    redirectPath: '/first-login',
  })

  await runInTransaction(claims, async (tx) => {
    await assignRole(tx, {
      userId: provisioned.userId,
      roleCode: ROLE_CODES.CUSTOMER,
      assignedBy: actorId,
    })

    await queueNotification(tx, {
      templateCode: NOTIFICATION_TEMPLATES.CUSTOMER_CREDENTIALS_ISSUED,
      recipientUserId: provisioned.userId,
      recipientAddress: phase1.header.contactEmail,
      variables: {
        contactName: phase1.header.contactName,
        legalName: phase1.header.legalName,
        email: phase1.header.contactEmail,
        activationUrl: provisioned.actionLink,
        expiryHours: 24,
      },
      sourceType: 'customer_application',
      sourceId: applicationId,
      actorId,
    })
  })

  return {
    customerId: phase1.customerId,
    customerCode: phase1.customerCode,
    userId: provisioned.userId,
  }
}
