import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import type { ApplicationStatus } from '../domain/application-status'
import { applicationStateMachine } from '../domain/application-status'

/**
 * Application-lifecycle writes. Every review action goes through `transitionApplication`,
 * which is enforcement layer 1 (the state machine assertion); there is no layer 3 database
 * trigger here the way the consignment spine has one, because unlike a consignment an
 * application's history is advisory, not the evidentiary record a custody dispute turns on.
 */

interface ApplicationHeader {
  readonly status: ApplicationStatus
  readonly reference: string
  readonly businessTypeId: string | null
  readonly branchId: string
  readonly legalName: string
  readonly contactName: string
  readonly contactEmail: string
  readonly contactPhone: string
}

export async function lockApplication(tx: Tx, id: string): Promise<ApplicationHeader> {
  const rows = await rawRows(
    tx,
    sql`
      select status, reference, business_type_id, branch_id, legal_name, contact_name, contact_email, contact_phone
      from public.customer_application where id = ${id}::uuid for update
    `,
  )
  const row = rows[0]
  if (!row) throw new Error(`Application ${id} not found`)
  return {
    status: col.text(row.status) as ApplicationStatus,
    reference: col.text(row.reference),
    businessTypeId: col.textOrNull(row.business_type_id),
    branchId: col.text(row.branch_id),
    legalName: col.text(row.legal_name),
    contactName: col.text(row.contact_name),
    contactEmail: col.text(row.contact_email),
    contactPhone: col.text(row.contact_phone),
  }
}

export interface TransitionApplicationInput {
  readonly id: string
  readonly to: ApplicationStatus
  readonly actorId: string | null
  readonly byApplicant: boolean
  readonly note?: string | null
}

export async function transitionApplication(
  tx: Tx,
  from: ApplicationStatus,
  input: TransitionApplicationInput,
): Promise<void> {
  applicationStateMachine.assert(from, input.to)

  const extra =
    input.to === 'UNDER_REVIEW' && from === 'SUBMITTED'
      ? sql`, review_started_at = now(), reviewed_by = ${input.actorId}::uuid`
      : input.to === 'APPROVED' || input.to === 'REJECTED'
        ? sql`, decided_at = now(), decided_by = ${input.actorId}::uuid`
        : sql``

  await tx.execute(sql`
    update public.customer_application
    set status = ${input.to}, updated_at = now(),
        updated_by = ${input.actorId}::uuid, version = version + 1
        ${extra}
    where id = ${input.id}::uuid
  `)

  await tx.execute(sql`
    insert into public.application_status_history (
      id, application_id, from_status, to_status, note, by_applicant, changed_at, changed_by
    ) values (
      ${uuidv7()}, ${input.id}::uuid, ${from}, ${input.to}, ${input.note ?? null},
      ${input.byApplicant}, now(), ${input.actorId}::uuid
    )
  `)
}

export async function setInfoRequested(tx: Tx, id: string, note: string): Promise<void> {
  await tx.execute(sql`
    update public.customer_application set info_requested = ${note}, updated_at = now()
    where id = ${id}::uuid
  `)
}

export async function setRejectionReason(tx: Tx, id: string, reason: string): Promise<void> {
  await tx.execute(sql`
    update public.customer_application set rejection_reason = ${reason}, updated_at = now()
    where id = ${id}::uuid
  `)
}

export async function linkApplicationToCustomer(
  tx: Tx,
  id: string,
  customerId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.customer_application set customer_id = ${customerId}::uuid, updated_at = now()
    where id = ${id}::uuid
  `)
}

export interface VerifyDocumentInput {
  readonly applicationId: string
  readonly documentTypeId: string
  readonly fileId: string | null
  readonly documentNumber?: string | null
  readonly issuedOn?: string | null
  readonly expiresOn?: string | null
  readonly actorId: string
}

/**
 * Attach or update a document's file and metadata. Verification is a SEPARATE step
 * (`setDocumentVerification`) — a reviewer attaches what the applicant sent, then decides.
 */
export async function upsertApplicationDocument(
  tx: Tx,
  input: VerifyDocumentInput,
): Promise<void> {
  await tx.execute(sql`
    insert into public.application_document (
      id, application_id, document_type_id, file_id, document_number, issued_on, expires_on,
      verification_status, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.applicationId}::uuid, ${input.documentTypeId}::uuid,
      ${input.fileId}::uuid, ${input.documentNumber ?? null}, ${input.issuedOn ?? null}::date,
      ${input.expiresOn ?? null}::date, 'PENDING',
      ${input.actorId}::uuid, now(), now()
    )
    on conflict (application_id, document_type_id) do update set
      file_id = excluded.file_id,
      document_number = coalesce(excluded.document_number, public.application_document.document_number),
      issued_on = coalesce(excluded.issued_on, public.application_document.issued_on),
      expires_on = coalesce(excluded.expires_on, public.application_document.expires_on),
      verification_status = 'PENDING',
      verified_by = null, verified_at = null, rejection_reason = null,
      updated_at = now(), updated_by = ${input.actorId}::uuid,
      version = public.application_document.version + 1
  `)
}

export interface UpdateApplicationDetailsInput {
  readonly legalName?: string | undefined
  readonly tradeName?: string | undefined
  readonly contactName?: string | undefined
  readonly contactPosition?: string | undefined
  readonly contactPhone?: string | undefined
  readonly contactEmail?: string | undefined
  readonly tin?: string | undefined
  readonly businessLicenceNo?: string | undefined
  readonly intendedServices?: string | undefined
  readonly branchId?: string | undefined
  readonly businessTypeId?: string | undefined
  readonly regionId?: string | undefined
  readonly city?: string | undefined
  readonly expectedAnnualVolumeKg?: string | undefined
  readonly primaryCoffeeTypeId?: string | undefined
}

/**
 * Apply an applicant's corrections. Every field is optional — the reply form only sends what
 * the applicant actually changed — so each column falls back to its current value via
 * `coalesce` rather than the caller having to build a dynamic SET list.
 */
export async function updateApplicationDetails(
  tx: Tx,
  id: string,
  input: UpdateApplicationDetailsInput,
  actorId: string | null,
): Promise<void> {
  await tx.execute(sql`
    update public.customer_application set
      legal_name = coalesce(${input.legalName ?? null}, legal_name),
      trade_name = coalesce(${input.tradeName ?? null}, trade_name),
      contact_name = coalesce(${input.contactName ?? null}, contact_name),
      contact_position = coalesce(${input.contactPosition ?? null}, contact_position),
      contact_phone = coalesce(${input.contactPhone ?? null}, contact_phone),
      contact_email = coalesce(${input.contactEmail ?? null}, contact_email),
      tin = coalesce(${input.tin ?? null}, tin),
      business_licence_no = coalesce(${input.businessLicenceNo ?? null}, business_licence_no),
      intended_services = coalesce(${input.intendedServices ?? null}, intended_services),
      branch_id = coalesce(${input.branchId ?? null}::uuid, branch_id),
      business_type_id = coalesce(${input.businessTypeId ?? null}::uuid, business_type_id),
      region_id = coalesce(${input.regionId ?? null}::uuid, region_id),
      city = coalesce(${input.city ?? null}, city),
      expected_annual_volume_kg = coalesce(${input.expectedAnnualVolumeKg ?? null}::numeric, expected_annual_volume_kg),
      primary_coffee_type_id = coalesce(${input.primaryCoffeeTypeId ?? null}::uuid, primary_coffee_type_id),
      updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${id}::uuid
  `)
}

export interface InsertApplicationMessageInput {
  readonly applicationId: string
  readonly senderKind: 'APPLICANT' | 'STAFF'
  readonly senderUserId: string | null
  readonly body: string
  readonly actorId: string
}

/** One entry in the applicant ⇄ reviewer reply thread. Append-only, like the status history. */
export async function insertApplicationMessage(
  tx: Tx,
  input: InsertApplicationMessageInput,
): Promise<void> {
  await tx.execute(sql`
    insert into public.application_message (
      id, application_id, sender_kind, sender_user_id, body, created_by, created_at
    ) values (
      ${uuidv7()}, ${input.applicationId}::uuid, ${input.senderKind},
      ${input.senderUserId}::uuid, ${input.body}, ${input.actorId}::uuid, now()
    )
  `)
}

export async function setDocumentVerification(
  tx: Tx,
  documentId: string,
  status: 'VERIFIED' | 'REJECTED',
  actorId: string,
  rejectionReason: string | null,
  documentNumber?: string | null,
  expiresOn?: string | null,
): Promise<void> {
  await tx.execute(sql`
    update public.application_document
    set verification_status = ${status}, verified_by = ${actorId}::uuid, verified_at = now(),
        rejection_reason = ${rejectionReason},
        document_number = coalesce(${documentNumber ?? null}, document_number),
        expires_on = coalesce(${expiresOn ?? null}::date, expires_on),
        updated_at = now(),
        updated_by = ${actorId}::uuid, version = version + 1
    where id = ${documentId}::uuid
  `)
}
