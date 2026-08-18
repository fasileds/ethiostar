import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for an Application Acknowledgement (M06 — onboarding).
 *
 * Issued the moment a prospective customer submits, confirming what was received and the
 * tracking reference they must quote to check status later. Assembled once, at print time,
 * and stored verbatim in `printed_document.printed_snapshot` — a later edit to the
 * application must not silently change what an already-issued acknowledgement says.
 */

export interface ApplicationAttachedDocument {
  readonly documentTypeName: string
  readonly originalFilename: string | null
}

export interface ApplicationAcknowledgementSnapshot {
  readonly applicationId: string
  readonly reference: string
  readonly legalName: string
  readonly businessTypeName: string | null
  readonly branchName: string
  readonly contactName: string
  readonly contactEmail: string
  readonly submittedAt: Date | null
  readonly attachedDocuments: readonly ApplicationAttachedDocument[]
}

export async function loadApplicationAcknowledgementSnapshot(
  tx: Tx,
  applicationId: string,
): Promise<ApplicationAcknowledgementSnapshot | undefined> {
  const headerRows = await rawRows(
    tx,
    sql`
      select
        a.id, a.reference, a.legal_name, a.contact_name, a.contact_email, a.submitted_at,
        bt.name_en as business_type_name, br.name_en as branch_name
      from public.customer_application a
      left join public.business_type bt on bt.id = a.business_type_id
      join public.branch br on br.id = a.branch_id
      where a.id = ${applicationId}::uuid
      limit 1
    `,
  )

  const header = headerRows[0]
  if (!header) return undefined

  const documentRows = await rawRows(
    tx,
    sql`
      select t.name_en as document_type_name, f.original_filename
      from public.application_document d
      join public.kyc_document_type t on t.id = d.document_type_id
      left join public.stored_file f on f.id = d.file_id
      where d.application_id = ${applicationId}::uuid
      order by t.sort_order, t.name_en
    `,
  )

  return {
    applicationId: col.text(header.id),
    reference: col.text(header.reference),
    legalName: col.text(header.legal_name),
    businessTypeName: col.textOrNull(header.business_type_name),
    branchName: col.text(header.branch_name),
    contactName: col.text(header.contact_name),
    contactEmail: col.text(header.contact_email),
    submittedAt: col.dateOrNull(header.submitted_at),
    attachedDocuments: documentRows.map((row) => ({
      documentTypeName: col.text(row.document_type_name),
      originalFilename: col.textOrNull(row.original_filename),
    })),
  }
}
