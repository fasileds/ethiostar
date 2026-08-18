import { sql } from 'drizzle-orm'
import { uuidv7 } from '../../src/core/ids/id-generator'
import { SYSTEM_ACTOR_ID } from '../../src/modules/identity/domain/actor'
import { OUTPUT_CLASSIFICATION_CODES } from '../../src/config/constants'
import type { SeedContext } from './types'

/**
 * M02 reference data.
 *
 * Idempotent: `on conflict (code) do update` on the display fields only. Structural columns
 * an administrator may have tuned (tolerances, expected yields, mandatory flags) are set on
 * INSERT and then left alone — a deploy must never silently revert a decision EthioStar
 * made in the admin console.
 *
 * ⚠️ PLACEHOLDER VALUES. Several figures below are engineering defaults, not EthioStar's
 * numbers. They are marked `-- CONFIRM:` and must be replaced from the Section 11 workshop
 * before UAT. See docs/architecture/10-risks-and-antipatterns.md §10.6.
 */

interface Lookup {
  code: string
  en: string
  am?: string
  extra?: Record<string, string | number | boolean | null>
}

/**
 * Not every lookup table carries `sort_order`.
 *
 * `region` and `reason_code_category` deliberately do not — they are ordered by name, and
 * the schema in src/db/schema/master-data.ts omits the column. This helper used to write it
 * unconditionally, so seeding failed on the first such table with
 * `column "sort_order" of relation "region" does not exist`.
 *
 * Resolved against information_schema rather than a hardcoded list, so adding the column to
 * a table later starts populating it with no change here. Cached — the seed runs this for
 * five tables and the answer cannot change mid-run.
 */
const sortOrderSupport = new Map<string, boolean>()

async function hasSortOrder(ctx: SeedContext, table: string): Promise<boolean> {
  const cached = sortOrderSupport.get(table)
  if (cached !== undefined) return cached

  const rows = (await ctx.tx.execute(sql`
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = ${table}
      and column_name  = 'sort_order'
  `)) as unknown as readonly unknown[]

  const present = rows.length > 0
  sortOrderSupport.set(table, present)
  return present
}

/** Insert-or-refresh a lookup row, leaving administrator-tuned columns untouched. */
async function upsertLookup(
  ctx: SeedContext,
  table: string,
  rows: readonly Lookup[],
  extraColumns: readonly string[] = [],
): Promise<number> {
  const sortable = await hasSortOrder(ctx, table)

  for (const [index, row] of rows.entries()) {
    const columns = ['id', 'code', 'name_en', 'name_am', 'created_by']
    const values: Array<string | number | boolean | null> = [
      uuidv7(),
      row.code,
      row.en,
      row.am ?? null,
      SYSTEM_ACTOR_ID,
    ]

    if (sortable) {
      columns.push('sort_order')
      values.push(index * 10)
    }

    // A column the row does not specify is OMITTED, not sent as NULL. Passing NULL
    // explicitly overrides the column's DEFAULT, which is how seeding died on
    // `null value in column "ownership" of relation "bag_type" violates not-null` —
    // `ownership` is NOT NULL DEFAULT 'ETHIOSTAR', and the default never got a chance.
    // Omitting also matches this seed's stated contract: structural columns are set on
    // INSERT and then left alone.
    for (const column of extraColumns) {
      const value = row.extra?.[column]
      if (value === undefined) continue
      columns.push(column)
      values.push(value)
    }

    const columnList = sql.raw(columns.map((c) => `"${c}"`).join(', '))
    const placeholders = sql.join(
      values.map((v) => sql`${v}`),
      sql`, `,
    )

    await ctx.tx.execute(sql`
      insert into ${sql.raw(`public."${table}"`)} (${columnList})
      values (${placeholders})
      on conflict (code) do update set
        name_en    = excluded.name_en,
        name_am    = excluded.name_am,
        ${sortable ? sql`sort_order = excluded.sort_order,` : sql``}
        updated_at = now()
    `)
  }
  return rows.length
}

export async function seedMasterData(ctx: SeedContext): Promise<void> {
  const { log } = ctx

  // ── Branch ────────────────────────────────────────────────────────────────
  await ctx.tx.execute(sql`
    insert into public.branch (id, code, name_en, name_am, city, created_by)
    values (${uuidv7()}, 'HQ', 'EthioStar Main Plant', 'ኢትዮስታር ዋና ፋብሪካ', 'Addis Ababa',
            ${SYSTEM_ACTOR_ID})
    on conflict (code) do update set name_en = excluded.name_en, updated_at = now()
  `)
  log('branch: 1')

  // ── THE FOUR OUTPUT CLASSIFICATIONS (M15) ─────────────────────────────────
  // Configurable records, not an enum. Only APPROVED carries is_primary, which is the one
  // flag downstream logic keys on.
  const outputs = [
    {
      code: OUTPUT_CLASSIFICATION_CODES.APPROVED,
      en: 'Approved / Export-Ready',
      am: 'የተፈቀደ / ለወጪ ንግድ ዝግጁ',
      primary: true,
      exportReady: true,
      yield: '80.000', // CONFIRM: expected yield share, for the capture-time outlier check
    },
    {
      code: OUTPUT_CLASSIFICATION_CODES.C_GRADE,
      en: 'C-Grade',
      am: 'ሲ-ደረጃ',
      primary: false,
      exportReady: false,
      yield: '11.000', // CONFIRM
    },
    {
      code: OUTPUT_CLASSIFICATION_CODES.GRAVITY,
      en: 'Gravity',
      am: 'ግራቪቲ',
      primary: false,
      exportReady: false,
      yield: '5.000', // CONFIRM
    },
    {
      code: OUTPUT_CLASSIFICATION_CODES.COLOUR_SORTER,
      en: 'Colour Sorter',
      am: 'የቀለም መለያ',
      primary: false,
      exportReady: false,
      yield: '3.000', // CONFIRM
    },
  ]

  for (const [index, output] of outputs.entries()) {
    await ctx.tx.execute(sql`
      insert into public.output_classification
        (id, code, name_en, name_am, is_primary, is_export_ready, expected_yield_pct,
         sort_order, created_by)
      values (${uuidv7()}, ${output.code}, ${output.en}, ${output.am}, ${output.primary},
              ${output.exportReady}, ${output.yield}, ${index * 10}, ${SYSTEM_ACTOR_ID})
      on conflict (code) do update set
        name_en = excluded.name_en, name_am = excluded.name_am, updated_at = now()
    `)
  }
  log(`output classifications: ${outputs.length} (APPROVED is the single primary output)`)

  // ── Coffee master data ────────────────────────────────────────────────────
  await upsertLookup(
    ctx,
    'coffee_type',
    [
      {
        code: 'WASHED',
        en: 'Washed',
        am: 'የታጠበ',
        extra: { mass_balance_tolerance_pct: '0.500' },
      },
      {
        code: 'NATURAL',
        en: 'Natural',
        am: 'ተፈጥሮአዊ',
        extra: { mass_balance_tolerance_pct: '0.800' },
      },
      {
        code: 'SEMI_WASHED',
        en: 'Semi-washed',
        am: 'ከፊል የታጠበ',
        extra: { mass_balance_tolerance_pct: '0.650' },
      },
    ],
    ['mass_balance_tolerance_pct'], // CONFIRM: tolerances per coffee type
  )
  log('coffee types: 3 (tolerances are PLACEHOLDERS — confirm at the workshop)')

  await upsertLookup(ctx, 'coffee_grade', [
    { code: 'G1', en: 'Grade 1' },
    { code: 'G2', en: 'Grade 2' },
    { code: 'G3', en: 'Grade 3' },
    { code: 'G4', en: 'Grade 4' },
    { code: 'G5', en: 'Grade 5' },
    { code: 'UG', en: 'Ungraded' },
  ])

  await upsertLookup(ctx, 'screen_size', [
    { code: 'SCR_14', en: 'Screen 14' },
    { code: 'SCR_15', en: 'Screen 15' },
    { code: 'SCR_16', en: 'Screen 16' },
    { code: 'SCR_18', en: 'Screen 18' },
  ])

  await upsertLookup(ctx, 'region', [
    { code: 'SIDAMA', en: 'Sidama', am: 'ሲዳማ' },
    { code: 'OROMIA', en: 'Oromia', am: 'ኦሮሚያ' },
    { code: 'SNNPR', en: 'South Ethiopia', am: 'ደቡብ ኢትዮጵያ' },
    { code: 'AMHARA', en: 'Amhara', am: 'አማራ' },
    { code: 'GAMBELA', en: 'Gambela', am: 'ጋምቤላ' },
  ])
  log('coffee grades, screen sizes and regions seeded')

  // ── Bag types, with an effective-dated standard weight ────────────────────
  await upsertLookup(
    ctx,
    'bag_type',
    [
      { code: 'JUTE_60', en: 'Jute 60 kg', am: 'ጁት 60 ኪግ', extra: { material: 'JUTE' } },
      { code: 'JUTE_85', en: 'Jute 85 kg', extra: { material: 'JUTE' } },
      { code: 'PP_50', en: 'Polypropylene 50 kg', extra: { material: 'PP' } },
      {
        code: 'CUSTOMER_OWN',
        en: 'Customer-owned bag',
        am: 'የደንበኛ ከረጢት',
        extra: { ownership: 'CUSTOMER', is_returnable: true },
      },
    ],
    ['material', 'ownership', 'is_returnable'],
  )

  // Open-ended initial version per bag type. `on conflict do nothing` keyed on the EXCLUDE
  // constraint means re-running the seed cannot create an overlapping version.
  const bagWeights: Array<[string, string]> = [
    ['JUTE_60', '60.000'],
    ['JUTE_85', '85.000'],
    ['PP_50', '50.000'],
    ['CUSTOMER_OWN', '60.000'], // CONFIRM: assumed weight for customer-supplied bags
  ]

  for (const [code, weight] of bagWeights) {
    await ctx.tx.execute(sql`
      insert into public.bag_type_version
        (id, bag_type_id, standard_net_weight_kg, weight_tolerance_pct, effective_from,
         created_by)
      select ${uuidv7()}, bt.id, ${weight}, '5.000', date '2020-01-01', ${SYSTEM_ACTOR_ID}
      from public.bag_type bt
      where bt.code = ${code}
        and not exists (
          select 1 from public.bag_type_version v where v.bag_type_id = bt.id
        )
    `)
  }
  log(`bag types: ${bagWeights.length}, each with an open-ended standard weight`)

  await upsertLookup(
    ctx,
    'bag_weight_class',
    [
      {
        code: 'LIGHT',
        en: 'Up to 50 kg',
        extra: { min_weight_kg: '0.000', max_weight_kg: '50.000' },
      },
      {
        code: 'STANDARD',
        en: '50–70 kg',
        extra: { min_weight_kg: '50.001', max_weight_kg: '70.000' },
      },
      {
        code: 'HEAVY',
        en: 'Over 70 kg',
        extra: { min_weight_kg: '70.001', max_weight_kg: null },
      },
    ],
    ['min_weight_kg', 'max_weight_kg'],
  )

  // ── Business types and the KYC checklist (M08) ─────────────────────────────
  await upsertLookup(ctx, 'business_type', [
    { code: 'EXPORTER', en: 'Exporter', am: 'ላኪ' },
    { code: 'SUPPLIER', en: 'Supplier', am: 'አቅራቢ' },
    { code: 'UNION', en: 'Union', am: 'ዩኒየን' },
    { code: 'COOPERATIVE', en: 'Cooperative', am: 'ኅብረት ሥራ ማህበር' },
    { code: 'INDIVIDUAL', en: 'Individual', am: 'ግለሰብ' },
  ])

  await upsertLookup(
    ctx,
    'kyc_document_type',
    [
      {
        code: 'TRADE_LICENCE',
        en: 'Trade licence',
        am: 'የንግድ ፈቃድ',
        extra: { has_expiry: true },
      },
      { code: 'TIN_CERTIFICATE', en: 'TIN certificate', extra: { has_expiry: false } },
      { code: 'VAT_CERTIFICATE', en: 'VAT certificate', extra: { has_expiry: false } },
      { code: 'EXPORT_LICENCE', en: 'Export licence', extra: { has_expiry: true } },
      { code: 'MEMORANDUM', en: 'Memorandum of association', extra: { has_expiry: false } },
      { code: 'SIGNATORY_ID', en: 'ID of authorised signatory', extra: { has_expiry: true } },
      { code: 'BANK_DETAILS', en: 'Bank details letter', extra: { has_expiry: false } },
      { code: 'STAMP_SPECIMEN', en: 'Company stamp specimen', extra: { has_expiry: false } },
    ],
    ['has_expiry'],
  )

  /**
   * ⚠️ CONFIRM WITH ETHIOSTAR — open question 6.
   * This mapping is an engineering default drawn from the document's "typically..." list.
   * The real per-business-type checklist comes from the Section 11 workshop and BLOCKS
   * Step 14 sign-off.
   */
  const checklist: Record<string, string[]> = {
    EXPORTER: [
      'TRADE_LICENCE',
      'TIN_CERTIFICATE',
      'VAT_CERTIFICATE',
      'EXPORT_LICENCE',
      'MEMORANDUM',
      'SIGNATORY_ID',
      'BANK_DETAILS',
      'STAMP_SPECIMEN',
    ],
    SUPPLIER: ['TRADE_LICENCE', 'TIN_CERTIFICATE', 'SIGNATORY_ID', 'BANK_DETAILS'],
    UNION: ['TRADE_LICENCE', 'TIN_CERTIFICATE', 'MEMORANDUM', 'SIGNATORY_ID', 'BANK_DETAILS'],
    COOPERATIVE: ['TRADE_LICENCE', 'TIN_CERTIFICATE', 'MEMORANDUM', 'SIGNATORY_ID'],
    INDIVIDUAL: ['TIN_CERTIFICATE', 'SIGNATORY_ID', 'BANK_DETAILS'],
  }

  let requirements = 0
  for (const [businessType, documents] of Object.entries(checklist)) {
    for (const document of documents) {
      await ctx.tx.execute(sql`
        insert into public.kyc_document_requirement
          (id, business_type_id, document_type_id, is_mandatory, created_by)
        select ${uuidv7()}, bt.id, dt.id, true, ${SYSTEM_ACTOR_ID}
        from public.business_type bt, public.kyc_document_type dt
        where bt.code = ${businessType} and dt.code = ${document}
        on conflict (business_type_id, document_type_id) do nothing
      `)
      requirements += 1
    }
  }
  log(`KYC checklist: ${requirements} requirements (PLACEHOLDER — confirm at the workshop)`)

  await seedOperationalReference(ctx)
}

/** Reason codes, labour activities, shifts and units. */
async function seedOperationalReference(ctx: SeedContext): Promise<void> {
  const { log } = ctx

  const categories = [
    { code: 'STOCK_ADJUSTMENT', en: 'Stock adjustment' },
    { code: 'PROCESS_LOSS', en: 'Process loss' },
    { code: 'APPOINTMENT_DELAY', en: 'Appointment delay' },
    { code: 'BAG_CONDEMNATION', en: 'Bag condemnation' },
    { code: 'MASS_BALANCE_VARIANCE', en: 'Mass-balance variance' },
    { code: 'REQUEST_REJECTION', en: 'Request rejection' },
  ]
  await upsertLookup(ctx, 'reason_code_category', categories)

  const reasons: Array<{
    category: string
    code: string
    en: string
    narrative?: boolean
    exception?: boolean
  }> = [
    { category: 'PROCESS_LOSS', code: 'LOSS_DUST', en: 'Dust' },
    { category: 'PROCESS_LOSS', code: 'LOSS_CHAFF', en: 'Chaff' },
    { category: 'PROCESS_LOSS', code: 'LOSS_MOISTURE', en: 'Moisture' },
    { category: 'PROCESS_LOSS', code: 'LOSS_SPILLAGE', en: 'Spillage', exception: true },
    {
      category: 'PROCESS_LOSS',
      code: 'LOSS_OTHER',
      en: 'Other',
      narrative: true,
      exception: true,
    },

    { category: 'APPOINTMENT_DELAY', code: 'DELAY_MACHINE', en: 'Machine breakdown' },
    { category: 'APPOINTMENT_DELAY', code: 'DELAY_POWER', en: 'Power interruption' },
    { category: 'APPOINTMENT_DELAY', code: 'DELAY_OVERRUN', en: 'Previous job overran' },
    { category: 'APPOINTMENT_DELAY', code: 'DELAY_CUSTOMER', en: 'Customer request' },
    { category: 'APPOINTMENT_DELAY', code: 'DELAY_LABOUR', en: 'Labour unavailable' },
    {
      category: 'APPOINTMENT_DELAY',
      code: 'DELAY_OTHER',
      en: 'Other',
      narrative: true,
      exception: true,
    },

    {
      category: 'STOCK_ADJUSTMENT',
      code: 'ADJ_COUNT_VARIANCE',
      en: 'Physical count variance',
      exception: true,
    },
    { category: 'STOCK_ADJUSTMENT', code: 'ADJ_DAMAGE', en: 'Damage', exception: true },
    {
      category: 'STOCK_ADJUSTMENT',
      code: 'ADJ_DATA_CORRECTION',
      en: 'Data entry correction',
      narrative: true,
      exception: true,
    },
    {
      category: 'STOCK_ADJUSTMENT',
      code: 'ADJ_OTHER',
      en: 'Other',
      narrative: true,
      exception: true,
    },

    { category: 'BAG_CONDEMNATION', code: 'BAG_TORN', en: 'Torn' },
    {
      category: 'BAG_CONDEMNATION',
      code: 'BAG_CONTAMINATED',
      en: 'Contaminated',
      exception: true,
    },
    { category: 'BAG_CONDEMNATION', code: 'BAG_WET', en: 'Water damaged', exception: true },

    {
      category: 'MASS_BALANCE_VARIANCE',
      code: 'MB_SCALE_DRIFT',
      en: 'Scale calibration drift',
      exception: true,
    },
    { category: 'MASS_BALANCE_VARIANCE', code: 'MB_MOISTURE', en: 'Moisture loss in store' },
    {
      category: 'MASS_BALANCE_VARIANCE',
      code: 'MB_UNEXPLAINED',
      en: 'Unexplained',
      narrative: true,
      exception: true,
    },

    { category: 'REQUEST_REJECTION', code: 'REJ_NO_CAPACITY', en: 'Insufficient capacity' },
    {
      category: 'REQUEST_REJECTION',
      code: 'REJ_DOCUMENTS',
      en: 'Documents incomplete or expired',
    },
    { category: 'REQUEST_REJECTION', code: 'REJ_OTHER', en: 'Other', narrative: true },
  ]

  for (const [index, reason] of reasons.entries()) {
    await ctx.tx.execute(sql`
      insert into public.reason_code
        (id, category_id, code, name_en, requires_narrative, is_exception, sort_order, created_by)
      select ${uuidv7()}, c.id, ${reason.code}, ${reason.en}, ${reason.narrative ?? false},
             ${reason.exception ?? false}, ${index * 10}, ${SYSTEM_ACTOR_ID}
      from public.reason_code_category c
      where c.code = ${reason.category}
      on conflict (code) do update set name_en = excluded.name_en, updated_at = now()
    `)
  }
  log(`reason codes: ${reasons.length} across ${categories.length} categories`)

  // M18: `derived_from_event` names the event whose CONFIRMED count drives the activity.
  await upsertLookup(
    ctx,
    'labour_activity_type',
    [
      {
        code: 'UNLOAD_TRUCK',
        en: 'Unloading from truck',
        am: 'ከመኪና ማራገፍ',
        extra: { derived_from_event: 'KeshaCountConfirmed' },
      },
      {
        code: 'LOAD_TO_LINE',
        en: 'Loading to line',
        extra: { derived_from_event: 'JobStarted' },
      },
      {
        code: 'LOAD_TRUCK',
        en: 'Loading to truck',
        extra: { derived_from_event: 'DispatchLoaded' },
      },
      { code: 'STACKING', en: 'Stacking', extra: { derived_from_event: 'ConsignmentStored' } },
      {
        code: 'RE_BAGGING',
        en: 'Re-bagging',
        extra: { derived_from_event: 'JobOutputsRecorded' },
      },
    ],
    ['derived_from_event'],
  )

  await upsertLookup(
    ctx,
    'shift',
    [
      {
        code: 'DAY',
        en: 'Day shift',
        am: 'የቀን ፈረቃ',
        extra: { starts_at: '06:00', ends_at: '14:00' },
      },
      {
        code: 'AFTERNOON',
        en: 'Afternoon shift',
        extra: { starts_at: '14:00', ends_at: '22:00' },
      },
      {
        code: 'NIGHT',
        en: 'Night shift',
        am: 'የሌሊት ፈረቃ',
        extra: { starts_at: '22:00', ends_at: '06:00', is_night_shift: true },
      },
    ],
    ['starts_at', 'ends_at', 'is_night_shift'],
  )

  await upsertLookup(
    ctx,
    'unit_of_measure',
    [
      {
        code: 'KG',
        en: 'Kilogram',
        am: 'ኪሎግራም',
        extra: { symbol: 'kg', decimal_places: 3, is_base_unit: true },
      },
      { code: 'KESHA', en: 'Kesha', am: 'ከረጢት', extra: { symbol: 'kesha', decimal_places: 0 } },
      { code: 'TONNE', en: 'Tonne', extra: { symbol: 't', decimal_places: 3 } },
    ],
    ['symbol', 'decimal_places', 'is_base_unit'],
  )

  log('labour activity types, shifts and units seeded')
}
