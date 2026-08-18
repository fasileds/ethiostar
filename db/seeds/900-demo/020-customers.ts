import { sql } from 'drizzle-orm'
import { demoId, addis, daysAgo } from './util'
import type { SeedContext } from '../types'

/**
 * M07/M08 demo data — applications across every review state, and the customers that
 * approved ones become.
 */

interface CodeLookup {
  [code: string]: string
}

async function lookupCodes(ctx: SeedContext, table: string): Promise<CodeLookup> {
  const rows = (await ctx.tx.execute(
    sql`select code, id from ${sql.raw(`public."${table}"`)}`,
  )) as unknown as Array<{ code: string; id: string }>
  const map: CodeLookup = {}
  for (const r of rows) map[r.code] = r.id
  return map
}

interface WoredaSeed {
  code: string
  en: string
  regionCode: string
}

const WOREDAS: readonly WoredaSeed[] = [
  { code: 'WRD_YIRGACHEFFE', en: 'Yirgacheffe', regionCode: 'SIDAMA' },
  { code: 'WRD_BENSA', en: 'Bensa', regionCode: 'SIDAMA' },
  { code: 'WRD_JIMMA', en: 'Jimma', regionCode: 'OROMIA' },
  { code: 'WRD_GUJI', en: 'Guji', regionCode: 'OROMIA' },
  { code: 'WRD_KAFFA', en: 'Kaffa', regionCode: 'SNNPR' },
  { code: 'WRD_BOLE', en: 'Bole (Addis Ababa)', regionCode: 'OROMIA' },
]

export interface CustomerSeed {
  seed: string
  code: string
  legalName: string
  tradeName?: string
  businessType: 'EXPORTER' | 'SUPPLIER' | 'UNION' | 'COOPERATIVE' | 'INDIVIDUAL'
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
  woredaCode: string
  phone: string
  email: string
  tin: string
}

export const DEMO_CUSTOMERS: readonly CustomerSeed[] = [
  {
    seed: 'customer:abyssinia-highland',
    code: 'CUS-2026-000001',
    legalName: 'Abyssinia Highland Exports PLC',
    tradeName: 'Abyssinia Highland',
    businessType: 'EXPORTER',
    status: 'ACTIVE',
    woredaCode: 'WRD_BOLE',
    phone: '+251911223344',
    email: 'ops@abyssiniahighland.et',
    tin: '000111222',
  },
  {
    seed: 'customer:oromia-coffee-union',
    code: 'CUS-2026-000002',
    legalName: 'Oromia Coffee Farmers Cooperative Union',
    tradeName: 'OCFCU',
    businessType: 'UNION',
    status: 'ACTIVE',
    woredaCode: 'WRD_JIMMA',
    phone: '+251911334455',
    email: 'info@ocfcu.et',
    tin: '000222333',
  },
  {
    seed: 'customer:yirgacheffe-farmers',
    code: 'CUS-2026-000003',
    legalName: 'Yirgacheffe Farmers Cooperative',
    businessType: 'COOPERATIVE',
    status: 'ACTIVE',
    woredaCode: 'WRD_YIRGACHEFFE',
    phone: '+251911445566',
    email: 'coop@yirgacheffefarmers.et',
    tin: '000333444',
  },
  {
    seed: 'customer:sidama-bensa-supplier',
    code: 'CUS-2026-000004',
    legalName: 'Sidama Bensa Washing Station Supplies plc',
    tradeName: 'Bensa Supplies',
    businessType: 'SUPPLIER',
    status: 'ACTIVE',
    woredaCode: 'WRD_BENSA',
    phone: '+251911556677',
    email: 'contact@bensasupplies.et',
    tin: '000444555',
  },
  {
    seed: 'customer:kaffa-forest-trading',
    code: 'CUS-2026-000005',
    legalName: 'Kaffa Forest Coffee Trading PLC',
    tradeName: 'Kaffa Forest',
    businessType: 'EXPORTER',
    status: 'ACTIVE',
    woredaCode: 'WRD_KAFFA',
    phone: '+251911667788',
    email: 'export@kaffaforest.et',
    tin: '000555666',
  },
  {
    seed: 'customer:guji-highlands',
    code: 'CUS-2026-000006',
    legalName: 'Guji Highlands Export PLC',
    businessType: 'EXPORTER',
    status: 'SUSPENDED',
    woredaCode: 'WRD_GUJI',
    phone: '+251911778899',
    email: 'admin@gujihighlands.et',
    tin: '000666777',
  },
  {
    seed: 'customer:tesfaye-bekele',
    code: 'CUS-2026-000007',
    legalName: 'Tesfaye Bekele',
    tradeName: 'Tesfaye Bekele Coffee Supply',
    businessType: 'INDIVIDUAL',
    status: 'ACTIVE',
    woredaCode: 'WRD_BOLE',
    phone: '+251911889900',
    email: 'tesfaye.bekele@example.com',
    tin: '000777888',
  },
  {
    seed: 'customer:limu-kossa-union',
    code: 'CUS-2026-000008',
    legalName: 'Limu Kossa Cooperative Union',
    businessType: 'UNION',
    status: 'CLOSED',
    woredaCode: 'WRD_JIMMA',
    phone: '+251911990011',
    email: 'office@limukossa.et',
    tin: '000888999',
  },
]

/** Standalone applications that never became customers — the review-queue variety. */
interface StandaloneApplicationSeed {
  seed: string
  reference: string
  legalName: string
  businessType: 'EXPORTER' | 'SUPPLIER' | 'UNION' | 'COOPERATIVE' | 'INDIVIDUAL'
  status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'INFO_REQUESTED' | 'REJECTED' | 'WITHDRAWN'
  contactName: string
  contactPhone: string
  contactEmail: string
  daysAgoSubmitted: number
  note?: string
}

const STANDALONE_APPLICATIONS: readonly StandaloneApplicationSeed[] = [
  {
    seed: 'application:habesha-gold',
    reference: 'APP-DEMO-Q7X9K2M4',
    legalName: 'Habesha Gold Coffee Exports PLC',
    businessType: 'EXPORTER',
    status: 'SUBMITTED',
    contactName: 'Fasil Girma',
    contactPhone: '+251912001122',
    contactEmail: 'fasil@habeshagold.et',
    daysAgoSubmitted: 4,
  },
  {
    seed: 'application:bale-mountain',
    reference: 'APP-DEMO-B3N7T1W5',
    legalName: 'Bale Mountain Coffee Cooperative',
    businessType: 'COOPERATIVE',
    status: 'UNDER_REVIEW',
    contactName: 'Chaltu Debela',
    contactPhone: '+251912002233',
    contactEmail: 'chaltu@balemountaincoffee.et',
    daysAgoSubmitted: 9,
  },
  {
    seed: 'application:nur-hussein',
    reference: 'APP-DEMO-H8P2R6Y3',
    legalName: 'Nur Hussein Trading',
    businessType: 'SUPPLIER',
    status: 'INFO_REQUESTED',
    contactName: 'Nur Hussein',
    contactPhone: '+251912003344',
    contactEmail: 'nur.hussein@example.com',
    daysAgoSubmitted: 15,
    note: 'VAT certificate expired — please upload a current one.',
  },
  {
    seed: 'application:zeleke-alemu',
    reference: 'APP-DEMO-Z4K9C2V8',
    legalName: 'Zeleke Alemu',
    businessType: 'INDIVIDUAL',
    status: 'REJECTED',
    contactName: 'Zeleke Alemu',
    contactPhone: '+251912004455',
    contactEmail: 'zeleke.alemu@example.com',
    daysAgoSubmitted: 40,
    note: 'No verifiable trade licence on record with the woreda office.',
  },
  {
    seed: 'application:metu-union-draft',
    reference: 'APP-DEMO-M1D5F7J2',
    legalName: 'Metu Coffee Farmers Union',
    businessType: 'UNION',
    status: 'DRAFT',
    contactName: 'Getachew Firew',
    contactPhone: '+251912005566',
    contactEmail: 'getachew@metuunion.et',
    daysAgoSubmitted: 1,
  },
  {
    seed: 'application:jimma-highlands-withdrawn',
    reference: 'APP-DEMO-J6W3N9X1',
    legalName: 'Jimma Highlands PLC',
    businessType: 'EXPORTER',
    status: 'WITHDRAWN',
    contactName: 'Mahlet Girma',
    contactPhone: '+251912006677',
    contactEmail: 'mahlet@jimmahighlands.et',
    daysAgoSubmitted: 60,
    note: 'Applicant found a warehousing partner closer to Jimma.',
  },
]

export interface CustomerRefs {
  customerIdBySeed: Map<string, string>
  branchId: string
}

export async function seedCustomersAndOnboarding(
  ctx: SeedContext,
  branchId: string,
  reviewerUserId: string,
): Promise<CustomerRefs> {
  const { log } = ctx

  // ── Woredas (missing from the base reference seed; needed for realistic addresses) ──
  const regions = await lookupCodes(ctx, 'region')
  for (const [index, w] of WOREDAS.entries()) {
    const regionId = regions[w.regionCode]
    if (!regionId) continue
    await ctx.tx.execute(sql`
      insert into public.woreda (id, region_id, code, name_en, created_by)
      values (${demoId(`woreda:${w.code}`)}, ${regionId}, ${w.code}, ${w.en}, ${reviewerUserId})
      on conflict (code) do update set name_en = excluded.name_en
    `)
  }
  const woredas = await lookupCodes(ctx, 'woreda')
  const businessTypes = await lookupCodes(ctx, 'business_type')

  const customerIdBySeed = new Map<string, string>()

  for (const [index, c] of DEMO_CUSTOMERS.entries()) {
    const customerId = demoId(c.seed)
    const applicationId = demoId(`application:${c.seed}`)
    const woredaId = woredas[c.woredaCode] ?? null
    const businessTypeId = businessTypes[c.businessType] ?? null
    const submittedAt = addis(daysAgo(120 - index * 6), 9, 15)
    const decidedAt = addis(daysAgo(110 - index * 6), 14, 0)

    // customer.application_id -> customer_application.id AND customer_application.customer_id
    // -> customer.id are both enforced FKs (see migration 0008), and
    // ck_customer_application__approved_has_customer additionally requires customer_id to be
    // set whenever status = APPROVED. Neither row can be inserted complete on the first try,
    // so: insert the application as SUBMITTED with no customer yet (satisfies the check),
    // insert the customer pointing at it (satisfies the customer->application FK), then
    // promote the application to APPROVED with the customer attached (satisfies the
    // application->customer FK and the check, in that order).
    await ctx.tx.execute(sql`
      insert into public.customer_application
        (id, reference, branch_id, legal_name, trade_name, business_type_id, tin,
         region_id, woreda_id, contact_name, contact_position, contact_phone, contact_email,
         status, submitted_at, review_started_at, reviewed_by, created_by)
      values (${applicationId}, ${`APP-2026-${String(index + 1).padStart(6, '0')}`}, ${branchId},
             ${c.legalName}, ${c.tradeName ?? null}, ${businessTypeId}, ${c.tin},
             (select region_id from public.woreda where id = ${woredaId}), ${woredaId},
             'Head Office Contact', 'Manager', ${c.phone}, ${c.email},
             'SUBMITTED', ${submittedAt}, ${submittedAt}, ${reviewerUserId}, ${reviewerUserId})
      on conflict (id) do nothing
    `)

    await ctx.tx.execute(sql`
      insert into public.customer
        (id, code, branch_id, legal_name, trade_name, business_type_id, tin, region_id,
         woreda_id, primary_phone, primary_email, status, suspended_reason, application_id,
         onboarded_on, created_by)
      values (${customerId}, ${c.code}, ${branchId}, ${c.legalName}, ${c.tradeName ?? null},
              ${businessTypeId}, ${c.tin},
              (select region_id from public.woreda where id = ${woredaId}),
              ${woredaId}, ${c.phone}, ${c.email}, ${c.status},
              ${c.status === 'SUSPENDED' ? 'Overdue account review pending' : null},
              ${applicationId}, ${daysAgo(110 - index * 6)}, ${reviewerUserId})
      on conflict (id) do nothing
    `)
    customerIdBySeed.set(c.seed, customerId)

    await ctx.tx.execute(sql`
      update public.customer_application
      set status = 'APPROVED', decided_at = ${decidedAt}, decided_by = ${reviewerUserId},
          decision_note = 'Approved — documents verified.', customer_id = ${customerId}
      where id = ${applicationId}
    `)

    await ctx.tx.execute(sql`
      insert into public.application_status_history
        (id, application_id, from_status, to_status, note, by_applicant, changed_at, changed_by)
      values (${demoId(`app_status:${c.seed}:submitted`)}, ${applicationId}, null, 'SUBMITTED',
              null, true, ${submittedAt}, null)
      on conflict (id) do nothing
    `)
    await ctx.tx.execute(sql`
      insert into public.application_status_history
        (id, application_id, from_status, to_status, note, by_applicant, changed_at, changed_by)
      values (${demoId(`app_status:${c.seed}:approved`)}, ${applicationId}, 'SUBMITTED',
              'APPROVED', 'Approved — documents verified.', false, ${decidedAt}, ${reviewerUserId})
      on conflict (id) do nothing
    `)

    if (c.status !== 'ACTIVE') {
      await ctx.tx.execute(sql`
        insert into public.customer_status_history
          (id, customer_id, from_status, to_status, reason, changed_at, changed_by)
        values (${demoId(`customer_status:${c.seed}`)}, ${customerId}, 'ACTIVE', ${c.status},
                ${c.status === 'SUSPENDED' ? 'Overdue account review pending' : 'Ceased operations'},
                ${addis(daysAgo(20), 10, 0)}, ${reviewerUserId})
        on conflict (id) do nothing
      `)
    }

    // Primary contact, empowered to authorise release.
    await ctx.tx.execute(sql`
      insert into public.customer_contact
        (id, customer_id, full_name, position, phone, email, is_primary,
         can_authorise_release, created_by)
      values (${demoId(`contact:${c.seed}:primary`)}, ${customerId}, 'Head Office Contact',
              'General Manager', ${c.phone}, ${c.email}, true, true, ${reviewerUserId})
      on conflict (id) do nothing
    `)
    // A second contact who may NOT authorise release — exercises the release-request guard.
    await ctx.tx.execute(sql`
      insert into public.customer_contact
        (id, customer_id, full_name, position, phone, email, is_primary,
         can_authorise_release, created_by)
      values (${demoId(`contact:${c.seed}:junior`)}, ${customerId}, 'Warehouse Liaison Officer',
              'Logistics Officer', ${c.phone}, ${c.email}, false, false, ${reviewerUserId})
      on conflict (id) do nothing
    `)

    await ctx.tx.execute(sql`
      insert into public.customer_address
        (id, customer_id, address_type, region_id, woreda_id, city, sub_city, po_box, created_by)
      values (${demoId(`address:${c.seed}`)}, ${customerId}, 'HEAD_OFFICE',
              (select region_id from public.woreda where id = ${woredaId}), ${woredaId},
              'Addis Ababa', 'Bole', ${`${1200 + index}`}, ${reviewerUserId})
      on conflict (id) do nothing
    `)

    await ctx.tx.execute(sql`
      insert into public.customer_bank_account
        (id, customer_id, bank_name, branch_name, account_name, account_number, is_primary,
         created_by)
      values (${demoId(`bank:${c.seed}`)}, ${customerId}, 'Commercial Bank of Ethiopia',
              'Bole Branch', ${c.legalName}, ${`10000${index}${index}2345`}, true, ${reviewerUserId})
      on conflict (id) do nothing
    `)
  }

  log(`customers: ${DEMO_CUSTOMERS.length} (statuses: ACTIVE x6, SUSPENDED x1, CLOSED x1)`)

  // ── Standalone applications: the review queue, in every non-approved state ──
  for (const a of STANDALONE_APPLICATIONS) {
    const applicationId = demoId(a.seed)
    const businessTypeId = businessTypes[a.businessType] ?? null
    const submittedAt = a.status === 'DRAFT' ? null : addis(daysAgo(a.daysAgoSubmitted), 10, 30)

    await ctx.tx.execute(sql`
      insert into public.customer_application
        (id, reference, branch_id, legal_name, business_type_id, contact_name, contact_phone,
         contact_email, status, submitted_at, review_started_at, reviewed_by, decided_at,
         decided_by, rejection_reason, info_requested, submitted_ip, created_by)
      values (${applicationId}, ${a.reference}, ${branchId}, ${a.legalName}, ${businessTypeId},
              ${a.contactName}, ${a.contactPhone}, ${a.contactEmail}, ${a.status},
              ${submittedAt},
              ${a.status === 'UNDER_REVIEW' || a.status === 'INFO_REQUESTED' ? submittedAt : null},
              ${a.status === 'UNDER_REVIEW' || a.status === 'INFO_REQUESTED' ? reviewerUserId : null},
              ${a.status === 'REJECTED' ? addis(daysAgo(a.daysAgoSubmitted - 5), 11, 0) : null},
              ${a.status === 'REJECTED' ? reviewerUserId : null},
              ${a.status === 'REJECTED' ? a.note : null},
              ${a.status === 'INFO_REQUESTED' ? a.note : null},
              '41.0.0.10', ${reviewerUserId})
      on conflict (id) do nothing
    `)

    await ctx.tx.execute(sql`
      insert into public.application_status_history
        (id, application_id, from_status, to_status, note, by_applicant, changed_at, changed_by)
      values (${demoId(`app_status:${a.seed}:initial`)}, ${applicationId}, null,
              ${a.status === 'DRAFT' ? 'DRAFT' : 'SUBMITTED'}, null, true,
              ${submittedAt ?? addis(daysAgo(a.daysAgoSubmitted), 9, 0)}, null)
      on conflict (id) do nothing
    `)
    if (a.status !== 'DRAFT' && a.status !== 'SUBMITTED') {
      await ctx.tx.execute(sql`
        insert into public.application_status_history
          (id, application_id, from_status, to_status, note, by_applicant, changed_at, changed_by)
        values (${demoId(`app_status:${a.seed}:final`)}, ${applicationId}, 'SUBMITTED',
                ${a.status}, ${a.note ?? null}, ${a.status === 'WITHDRAWN'},
                ${addis(daysAgo(Math.max(a.daysAgoSubmitted - 3, 0)), 13, 0)},
                ${a.status === 'WITHDRAWN' ? null : reviewerUserId})
        on conflict (id) do nothing
      `)
    }
  }
  log(
    `standalone applications: ${STANDALONE_APPLICATIONS.length} (one per non-approved status)`,
  )

  return { customerIdBySeed, branchId }
}
