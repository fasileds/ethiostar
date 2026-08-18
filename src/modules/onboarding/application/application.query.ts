import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import {
  rawRows,
  col,
  listLimit,
  keysetBefore,
  toListPage,
  cursorValue,
  type ListPage,
} from '@db/helpers/list-query'

/**
 * M08 read models.
 *
 * The review queue, the detail a reviewer decides from, and the public status lookup.
 *
 * The public lookup is separated deliberately: it returns a NARROW projection — status,
 * dates and any information the reviewer asked for — and never the TIN, the licence number
 * or the reviewer's internal notes. An applicant quoting a reference is not authenticated,
 * so anything this function returns should be treated as public.
 */

export interface ApplicationListRow {
  readonly id: string
  readonly reference: string
  readonly legalName: string
  readonly tradeName: string | null
  readonly contactName: string
  readonly contactPhone: string
  readonly status: string
  readonly submittedAt: Date | null
  readonly createdAt: Date
  readonly documentsTotal: number
  readonly documentsVerified: number
}

export interface ApplicationFilters {
  readonly status?: string | undefined
  readonly search?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

export async function listApplications(
  tx: Tx,
  filters: ApplicationFilters = {},
): Promise<ListPage<ApplicationListRow>> {
  const limit = listLimit(filters.limit)
  const search = filters.search?.trim()

  const rows = await rawRows(
    tx,
    sql`
    select
      a.id, a.reference, a.legal_name, a.trade_name,
      a.contact_name, a.contact_phone, a.status,
      a.submitted_at, a.created_at,
      count(d.id)::int                                                as documents_total,
      count(d.id) filter (where d.verification_status = 'VERIFIED')::int as documents_verified
    from public.customer_application a
    left join public.application_document d on d.application_id = a.id
    where 1 = 1
      ${filters.status ? sql`and a.status = ${filters.status}` : sql``}
      ${
        search
          ? sql`and (
              a.legal_name ilike ${'%' + search + '%'}
              or a.reference ilike ${'%' + search + '%'}
              or a.contact_name ilike ${'%' + search + '%'}
              or a.tin = ${search}
            )`
          : sql``
      }
      ${/* Keyset, not OFFSET: the queue is scanned forward, never paged deep into. */ sql``}
      ${keysetBefore(sql`a.created_at`, sql`a.id`, filters.cursor)}
    group by a.id
    order by a.created_at desc, a.id desc
    limit ${limit + 1}
  `,
  )

  return toListPage(
    rows.map((row): ApplicationListRow => ({
      id: col.text(row.id),
      reference: col.text(row.reference),
      legalName: col.text(row.legal_name),
      tradeName: col.textOrNull(row.trade_name),
      contactName: col.text(row.contact_name),
      contactPhone: col.text(row.contact_phone),
      status: col.text(row.status),
      submittedAt: col.dateOrNull(row.submitted_at),
      createdAt: col.date(row.created_at),
      documentsTotal: col.int(row.documents_total),
      documentsVerified: col.int(row.documents_verified),
    })),
    limit,
    (row) => ({ sortValue: cursorValue(row.createdAt), id: row.id }),
  )
}

/** Counts per status, for the filter tabs. One query rather than one per tab. */
export async function applicationStatusCounts(
  tx: Tx,
): Promise<Readonly<Record<string, number>>> {
  const result = await tx.execute(sql`
    select status, count(*)::int as total
    from public.customer_application
    group by status
  `)

  const rows = result as unknown as Array<{ status: string; total: number }>
  return Object.fromEntries(rows.map((row) => [row.status, row.total]))
}

export interface ApplicationDetail extends ApplicationListRow {
  readonly legalNameAm: string | null
  readonly tin: string | null
  readonly businessLicenceNo: string | null
  readonly licenceExpiresOn: string | null
  readonly ecxMembershipNo: string | null
  readonly contactPosition: string | null
  readonly contactEmail: string
  readonly city: string | null
  readonly regionName: string | null
  readonly woredaName: string | null
  readonly businessTypeName: string | null
  readonly expectedAnnualVolumeKg: string | null
  readonly expectedKeshaPerSeason: number | null
  readonly intendedServices: string | null
  readonly decisionNote: string | null
  readonly rejectionReason: string | null
  readonly infoRequested: string | null
  readonly decidedAt: Date | null
  readonly customerId: string | null
  readonly branchName: string | null
}

export async function findApplication(
  tx: Tx,
  id: string,
): Promise<ApplicationDetail | undefined> {
  const result = await tx.execute(sql`
    select
      a.*,
      b.name_en  as branch_name,
      r.name_en  as region_name,
      w.name_en  as woreda_name,
      bt.name_en as business_type_name,
      (select count(*) from public.application_document d where d.application_id = a.id)::int
        as documents_total,
      (select count(*) from public.application_document d
        where d.application_id = a.id and d.verification_status = 'VERIFIED')::int
        as documents_verified
    from public.customer_application a
    left join public.branch b        on b.id  = a.branch_id
    left join public.region r        on r.id  = a.region_id
    left join public.woreda w        on w.id  = a.woreda_id
    left join public.business_type bt on bt.id = a.business_type_id
    where a.id = ${id}::uuid
    limit 1
  `)

  const rows = result as unknown as Array<Record<string, unknown>>
  const row = rows[0]
  if (!row) return undefined

  return {
    id: String(row.id),
    reference: String(row.reference),
    legalName: String(row.legal_name),
    tradeName: (row.trade_name as string | null) ?? null,
    legalNameAm: (row.legal_name_am as string | null) ?? null,
    tin: (row.tin as string | null) ?? null,
    businessLicenceNo: (row.business_licence_no as string | null) ?? null,
    licenceExpiresOn: (row.licence_expires_on as string | null) ?? null,
    ecxMembershipNo: (row.ecx_membership_no as string | null) ?? null,
    contactName: String(row.contact_name),
    contactPosition: (row.contact_position as string | null) ?? null,
    contactPhone: String(row.contact_phone),
    contactEmail: String(row.contact_email),
    city: (row.city as string | null) ?? null,
    regionName: (row.region_name as string | null) ?? null,
    woredaName: (row.woreda_name as string | null) ?? null,
    businessTypeName: (row.business_type_name as string | null) ?? null,
    branchName: (row.branch_name as string | null) ?? null,
    expectedAnnualVolumeKg: row.expected_annual_volume_kg
      ? String(row.expected_annual_volume_kg)
      : null,
    expectedKeshaPerSeason: (row.expected_kesha_per_season as number | null) ?? null,
    intendedServices: (row.intended_services as string | null) ?? null,
    status: String(row.status),
    decisionNote: (row.decision_note as string | null) ?? null,
    rejectionReason: (row.rejection_reason as string | null) ?? null,
    infoRequested: (row.info_requested as string | null) ?? null,
    submittedAt: col.dateOrNull(row.submitted_at),
    decidedAt: col.dateOrNull(row.decided_at),
    createdAt: col.date(row.created_at),
    customerId: (row.customer_id as string | null) ?? null,
    documentsTotal: Number(row.documents_total),
    documentsVerified: Number(row.documents_verified),
  }
}

export interface ApplicationDocumentRow {
  readonly documentTypeId: string
  readonly documentTypeCode: string
  readonly documentTypeName: string
  readonly hasExpiry: boolean
  readonly isMandatory: boolean
  /** Null when the document is required but has not been supplied. */
  readonly id: string | null
  readonly documentNumber: string | null
  readonly expiresOn: string | null
  readonly verificationStatus: string | null
  readonly rejectionReason: string | null
  readonly fileId: string | null
  readonly originalFilename: string | null
  /** `stored_file.status` — PENDING | AVAILABLE | QUARANTINED | DELETED, or null if unset. */
  readonly fileStatus: string | null
}

/**
 * The KYC checklist — required document types LEFT JOINed to what was actually supplied.
 *
 * Driven from the requirement list rather than from the uploads, because the useful question
 * is "what is still missing", and a query over uploads can only ever answer "what is here".
 * `is_mandatory` varies by business type: a cooperative union and a private exporter do not
 * owe the same paperwork.
 *
 * Documents supplied that are NOT on the list still appear (via the UNION), so an extra
 * attachment is never silently hidden from the reviewer.
 */
export async function applicationDocuments(
  tx: Tx,
  applicationId: string,
): Promise<ApplicationDocumentRow[]> {
  const result = await tx.execute(sql`
    with app as (
      select id, business_type_id from public.customer_application where id = ${applicationId}::uuid
    ),
    required as (
      select r.document_type_id, r.is_mandatory
      from public.kyc_document_requirement r
      join app on app.business_type_id = r.business_type_id
    ),
    supplied as (
      select d.document_type_id from public.application_document d
      where d.application_id = ${applicationId}::uuid
    ),
    types as (
      select document_type_id, is_mandatory from required
      union
      select document_type_id, false from supplied
        where document_type_id not in (select document_type_id from required)
    )
    select
      t.id   as document_type_id,
      t.code as document_type_code,
      t.name_en as document_type_name,
      t.has_expiry,
      types.is_mandatory,
      d.id, d.document_number, d.expires_on, d.verification_status, d.rejection_reason,
      d.file_id,
      f.original_filename, f.status as file_status
    from types
    join public.kyc_document_type t on t.id = types.document_type_id
    left join public.application_document d
      on d.document_type_id = types.document_type_id
     and d.application_id = ${applicationId}::uuid
    left join public.stored_file f on f.id = d.file_id
    order by types.is_mandatory desc, t.sort_order, t.name_en
  `)

  const rows = result as unknown as Array<Record<string, unknown>>
  return rows.map((row) => ({
    documentTypeId: String(row.document_type_id),
    documentTypeCode: String(row.document_type_code),
    documentTypeName: String(row.document_type_name),
    hasExpiry: Boolean(row.has_expiry),
    isMandatory: Boolean(row.is_mandatory),
    id: row.id ? String(row.id) : null,
    documentNumber: (row.document_number as string | null) ?? null,
    expiresOn: (row.expires_on as string | null) ?? null,
    verificationStatus: (row.verification_status as string | null) ?? null,
    rejectionReason: (row.rejection_reason as string | null) ?? null,
    fileId: (row.file_id as string | null) ?? null,
    originalFilename: (row.original_filename as string | null) ?? null,
    fileStatus: (row.file_status as string | null) ?? null,
  }))
}

export interface StatusHistoryRow {
  readonly id: string
  readonly fromStatus: string | null
  readonly toStatus: string
  readonly note: string | null
  readonly byApplicant: boolean
  readonly changedAt: Date
  readonly changedByName: string | null
}

export async function applicationHistory(
  tx: Tx,
  applicationId: string,
): Promise<StatusHistoryRow[]> {
  const result = await tx.execute(sql`
    select h.*, u.full_name as changed_by_name
    from public.application_status_history h
    left join public.app_user u on u.id = h.changed_by
    where h.application_id = ${applicationId}::uuid
    order by h.changed_at desc
  `)

  const rows = result as unknown as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    fromStatus: (row.from_status as string | null) ?? null,
    toStatus: String(row.to_status),
    note: (row.note as string | null) ?? null,
    byApplicant: Boolean(row.by_applicant),
    changedAt: col.date(row.changed_at),
    changedByName: (row.changed_by_name as string | null) ?? null,
  }))
}

export interface ApplicationMessageRow {
  readonly id: string
  readonly senderKind: 'APPLICANT' | 'STAFF'
  readonly senderName: string | null
  readonly body: string
  readonly createdAt: Date
}

/** The reply thread, oldest first — chat order, not the status history's newest-first log. */
export async function applicationMessages(
  tx: Tx,
  applicationId: string,
): Promise<ApplicationMessageRow[]> {
  const result = await tx.execute(sql`
    select m.*, u.full_name as sender_name
    from public.application_message m
    left join public.app_user u on u.id = m.sender_user_id
    where m.application_id = ${applicationId}::uuid
    order by m.created_at asc
  `)

  const rows = result as unknown as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    senderKind: String(row.sender_kind) as 'APPLICANT' | 'STAFF',
    senderName: (row.sender_name as string | null) ?? null,
    body: String(row.body),
    createdAt: col.date(row.created_at),
  }))
}

/**
 * The PUBLIC status lookup, by reference.
 *
 * Returns only what an unauthenticated holder of the reference may see. It does NOT return
 * the TIN, the licence number, the reviewer's identity or the internal decision note — a
 * reference is a locator, not a credential, and this projection is the enforcement of that.
 */
export interface PublicApplicationStatus {
  readonly reference: string
  readonly legalName: string
  readonly status: string
  readonly submittedAt: Date | null
  readonly decidedAt: Date | null
  /** Shown verbatim so the applicant knows exactly what to send. */
  readonly infoRequested: string | null
  readonly documentsTotal: number
  readonly documentsVerified: number
}

export async function findApplicationByReference(
  tx: Tx,
  reference: string,
): Promise<PublicApplicationStatus | undefined> {
  const result = await tx.execute(sql`
    select
      a.reference, a.legal_name, a.status, a.submitted_at, a.decided_at, a.info_requested,
      (select count(*) from public.application_document d where d.application_id = a.id)::int
        as documents_total,
      (select count(*) from public.application_document d
        where d.application_id = a.id and d.verification_status = 'VERIFIED')::int
        as documents_verified
    from public.customer_application a
    where a.reference = ${reference}
    limit 1
  `)

  const rows = result as unknown as Array<Record<string, unknown>>
  const row = rows[0]
  if (!row) return undefined

  return {
    reference: String(row.reference),
    legalName: String(row.legal_name),
    status: String(row.status),
    submittedAt: col.dateOrNull(row.submitted_at),
    decidedAt: col.dateOrNull(row.decided_at),
    infoRequested: (row.info_requested as string | null) ?? null,
    documentsTotal: Number(row.documents_total),
    documentsVerified: Number(row.documents_verified),
  }
}
