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
 * M07 read models.
 *
 * The list carries live custody figures, because "who are our customers" and "what are we
 * holding for them" are the same question in practice, and answering it in two screens means
 * two screens that disagree.
 */

export interface CustomerRow {
  readonly id: string
  readonly code: string
  readonly legalName: string
  readonly tradeName: string | null
  readonly businessTypeName: string | null
  readonly status: string
  readonly primaryPhone: string | null
  readonly primaryEmail: string | null
  readonly onHandKg: string
  readonly onHandKesha: number
  readonly openConsignments: number
  readonly createdAt: Date
}

export async function listCustomers(
  tx: Tx,
  filters: {
    status?: string | undefined
    search?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<CustomerRow>> {
  const limit = listLimit(filters.limit)
  const search = filters.search?.trim()

  const rows = await rawRows(
    tx,
    sql`
      select
        c.id, c.code, c.legal_name, c.trade_name, c.status,
        c.primary_phone, c.primary_email, c.created_at,
        bt.name_en as business_type_name,
        coalesce(bal.on_hand_kg, 0)        as on_hand_kg,
        coalesce(bal.on_hand_kesha, 0)::int as on_hand_kesha,
        (select count(*) from public.consignment cons
          where cons.customer_id = c.id
            and cons.status not in ('CLOSED','CANCELLED'))::int as open_consignments
      from public.customer c
      left join public.business_type bt on bt.id = c.business_type_id
      left join lateral (
        select sum(b.quantity_kg) as on_hand_kg, sum(b.kesha_count) as on_hand_kesha
        from public.stock_balance b
        where b.customer_id = c.id and b.quantity_kg > 0
      ) bal on true
      where 1 = 1
        ${filters.status ? sql`and c.status = ${filters.status}` : sql``}
        ${
          search
            ? sql`and (c.legal_name ilike ${'%' + search + '%'}
                    or c.trade_name ilike ${'%' + search + '%'}
                    or c.code ilike ${'%' + search + '%'}
                    or c.tin = ${search})`
            : sql``
        }
        ${keysetBefore(sql`c.created_at`, sql`c.id`, filters.cursor)}
      order by c.created_at desc, c.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(
    rows.map((row): CustomerRow => ({
      id: col.text(row.id),
      code: col.text(row.code),
      legalName: col.text(row.legal_name),
      tradeName: col.textOrNull(row.trade_name),
      businessTypeName: col.textOrNull(row.business_type_name),
      status: col.text(row.status),
      primaryPhone: col.textOrNull(row.primary_phone),
      primaryEmail: col.textOrNull(row.primary_email),
      onHandKg: col.numeric(row.on_hand_kg),
      onHandKesha: col.int(row.on_hand_kesha),
      openConsignments: col.int(row.open_consignments),
      createdAt: col.date(row.created_at),
    })),
    limit,
    (row) => ({ sortValue: cursorValue(row.createdAt), id: row.id }),
  )
}

export async function customerStatusCounts(tx: Tx): Promise<Readonly<Record<string, number>>> {
  const rows = await rawRows(
    tx,
    sql`select status, count(*)::int as total from public.customer group by status`,
  )
  return Object.fromEntries(rows.map((row) => [col.text(row.status), col.int(row.total)]))
}

export interface CustomerDetail extends CustomerRow {
  readonly legalNameAm: string | null
  readonly tin: string | null
  readonly businessLicenceNo: string | null
  readonly licenceExpiresOn: string | null
  readonly ecxMembershipNo: string | null
  readonly regionName: string | null
  readonly woredaName: string | null
  readonly branchId: string
  readonly branchName: string | null
  readonly onboardedOn: string | null
  readonly suspendedReason: string | null
  readonly applicationId: string | null
  readonly applicationReference: string | null
  readonly notes: string | null
}

export async function findCustomer(tx: Tx, id: string): Promise<CustomerDetail | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        c.*,
        bt.name_en as business_type_name,
        r.name_en  as region_name,
        w.name_en  as woreda_name,
        b.name_en  as branch_name,
        a.reference as application_reference,
        coalesce(bal.on_hand_kg, 0)         as on_hand_kg,
        coalesce(bal.on_hand_kesha, 0)::int as on_hand_kesha,
        (select count(*) from public.consignment cons
          where cons.customer_id = c.id
            and cons.status not in ('CLOSED','CANCELLED'))::int as open_consignments
      from public.customer c
      left join public.business_type bt on bt.id = c.business_type_id
      left join public.region r on r.id = c.region_id
      left join public.woreda w on w.id = c.woreda_id
      left join public.branch b on b.id = c.branch_id
      left join public.customer_application a on a.id = c.application_id
      left join lateral (
        select sum(sb.quantity_kg) as on_hand_kg, sum(sb.kesha_count) as on_hand_kesha
        from public.stock_balance sb
        where sb.customer_id = c.id and sb.quantity_kg > 0
      ) bal on true
      where c.id = ${id}::uuid
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    id: col.text(row.id),
    code: col.text(row.code),
    legalName: col.text(row.legal_name),
    tradeName: col.textOrNull(row.trade_name),
    legalNameAm: col.textOrNull(row.legal_name_am),
    businessTypeName: col.textOrNull(row.business_type_name),
    tin: col.textOrNull(row.tin),
    businessLicenceNo: col.textOrNull(row.business_licence_no),
    licenceExpiresOn: col.textOrNull(row.licence_expires_on),
    ecxMembershipNo: col.textOrNull(row.ecx_membership_no),
    regionName: col.textOrNull(row.region_name),
    woredaName: col.textOrNull(row.woreda_name),
    branchId: col.text(row.branch_id),
    branchName: col.textOrNull(row.branch_name),
    status: col.text(row.status),
    suspendedReason: col.textOrNull(row.suspended_reason),
    primaryPhone: col.textOrNull(row.primary_phone),
    primaryEmail: col.textOrNull(row.primary_email),
    onboardedOn: col.textOrNull(row.onboarded_on),
    applicationId: col.textOrNull(row.application_id),
    applicationReference: col.textOrNull(row.application_reference),
    notes: col.textOrNull(row.notes),
    onHandKg: col.numeric(row.on_hand_kg),
    onHandKesha: col.int(row.on_hand_kesha),
    openConsignments: col.int(row.open_consignments),
    createdAt: col.date(row.created_at),
  }
}

export interface ContactRow {
  readonly id: string
  readonly fullName: string
  readonly position: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly isPrimary: boolean
  readonly canAuthoriseRelease: boolean
  readonly isActive: boolean
}

export async function customerContacts(tx: Tx, customerId: string): Promise<ContactRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, full_name, position, phone, email, is_primary, can_authorise_release, is_active
      from public.customer_contact
      where customer_id = ${customerId}::uuid
      order by is_primary desc, is_active desc, full_name
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    fullName: col.text(row.full_name),
    position: col.textOrNull(row.position),
    phone: col.textOrNull(row.phone),
    email: col.textOrNull(row.email),
    isPrimary: col.bool(row.is_primary),
    canAuthoriseRelease: col.bool(row.can_authorise_release),
    isActive: col.bool(row.is_active),
  }))
}

export interface CustomerBankRow {
  readonly id: string
  readonly bankName: string
  readonly branchName: string | null
  readonly accountName: string
  /** Masked for display. The full number is never sent to a list screen. */
  readonly accountNumberMasked: string
  readonly isPrimary: boolean
}

/**
 * Bank accounts, with the number MASKED in the projection.
 *
 * Masking here rather than in the component means a future screen cannot accidentally render
 * the full number by picking a different field — the unmasked value simply never leaves the
 * database on this path.
 */
export async function customerBankAccounts(
  tx: Tx,
  customerId: string,
): Promise<CustomerBankRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        id, bank_name, branch_name, account_name, is_primary,
        '••••' || right(account_number, 4) as account_number_masked
      from public.customer_bank_account
      where customer_id = ${customerId}::uuid and is_active
      order by is_primary desc, bank_name
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    bankName: col.text(row.bank_name),
    branchName: col.textOrNull(row.branch_name),
    accountName: col.text(row.account_name),
    accountNumberMasked: col.text(row.account_number_masked),
    isPrimary: col.bool(row.is_primary),
  }))
}
