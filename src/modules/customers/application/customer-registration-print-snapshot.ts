import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Registration Certificate & Credential Letter (M06 —
 * onboarding). Issued once, on approval, confirming the customer is registered and that a
 * portal login was created for them.
 *
 * Lives here rather than in `onboarding/` because the source of record — and the `sourceId`
 * this document prints against — is the customer's own id, not the application's. This
 * module already owns customer-detail reads (see `customer.query.ts`); this is one more.
 *
 * The credential itself is never included — only that an account exists and where the
 * activation email went. Assembled once, at print time, and stored verbatim in
 * `printed_document.printed_snapshot`.
 */

export interface CustomerRegistrationSnapshot {
  readonly customerId: string
  readonly code: string
  readonly legalName: string
  readonly businessTypeName: string | null
  readonly branchName: string
  readonly onboardedOn: string | null
  readonly primaryContactEmail: string | null
  readonly credentialsIssued: boolean
}

export async function loadCustomerRegistrationSnapshot(
  tx: Tx,
  customerId: string,
): Promise<CustomerRegistrationSnapshot | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        c.id, c.code, c.legal_name, c.onboarded_on,
        bt.name_en as business_type_name, br.name_en as branch_name,
        coalesce(cc.email, c.primary_email) as primary_contact_email,
        exists (
          select 1 from public.app_user u
          where u.customer_id = c.id
        ) as credentials_issued
      from public.customer c
      left join public.business_type bt on bt.id = c.business_type_id
      join public.branch br on br.id = c.branch_id
      left join public.customer_contact cc
        on cc.customer_id = c.id and cc.is_primary and cc.is_active
      where c.id = ${customerId}::uuid
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    customerId: col.text(row.id),
    code: col.text(row.code),
    legalName: col.text(row.legal_name),
    businessTypeName: col.textOrNull(row.business_type_name),
    branchName: col.text(row.branch_name),
    onboardedOn: col.textOrNull(row.onboarded_on),
    primaryContactEmail: col.textOrNull(row.primary_contact_email),
    credentialsIssued: col.bool(row.credentials_issued),
  }
}
