import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { uuidv7 } from '@core/ids/id-generator'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'

/**
 * The customer row, written here rather than in `@modules/customers` — per that module's
 * own barrel comment: "A customer row is written only by the M08 approval use case, in the
 * same transaction that closes the application. There is deliberately no create path here."
 */

export interface CreateCustomerFromApplicationInput {
  readonly applicationId: string
  readonly branchId: string
  readonly legalName: string
  readonly tradeName: string | null
  readonly businessTypeId: string | null
  readonly tin: string | null
  readonly businessLicenceNo: string | null
  readonly licenceExpiresOn: string | null
  readonly regionId: string | null
  readonly woredaId: string | null
  readonly contactName: string
  readonly contactPosition: string | null
  readonly contactPhone: string
  readonly contactEmail: string
  readonly actorId: string
  readonly onboardedOn: string
}

export async function createCustomerFromApplication(
  tx: Tx,
  input: CreateCustomerFromApplicationInput,
): Promise<{ customerId: string; code: string }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.CUSTOMER, {
    actorId: input.actorId,
  })

  await tx.execute(sql`
    insert into public.customer (
      id, code, branch_id, legal_name, trade_name, business_type_id, tin,
      business_licence_no, licence_expires_on, region_id, woreda_id,
      primary_phone, primary_email, status, application_id, onboarded_on, is_active,
      created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.branchId}::uuid, ${input.legalName},
      ${input.tradeName}, ${input.businessTypeId}::uuid, ${input.tin},
      ${input.businessLicenceNo}, ${input.licenceExpiresOn}::date,
      ${input.regionId}::uuid, ${input.woredaId}::uuid,
      ${input.contactPhone}, ${input.contactEmail}, 'ACTIVE',
      ${input.applicationId}::uuid, ${input.onboardedOn}::date, true,
      ${input.actorId}::uuid, now(), now()
    )
  `)

  await tx.execute(sql`
    insert into public.customer_contact (
      id, customer_id, full_name, position, phone, email,
      is_primary, can_authorise_release, is_active, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${id}::uuid, ${input.contactName}, ${input.contactPosition},
      ${input.contactPhone}, ${input.contactEmail}, true, true, true,
      ${input.actorId}::uuid, now(), now()
    )
  `)

  return { customerId: id, code: allocated.formatted }
}
