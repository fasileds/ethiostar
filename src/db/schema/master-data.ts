import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  activeFlag,
  displayNames,
  weightKg,
  percent,
  calendarDate,
  effectivePeriod,
} from '../helpers/columns'

/**
 * M02 — Organisation & Master Data Management.
 *
 * "Getting master data right at the start is what prevents the same coffee grade being
 * spelled three different ways and making the yield report meaningless."
 *
 * TWO RULES GOVERN EVERYTHING HERE:
 *
 * 1. LOOKUP TABLES, NOT ENUMS. The client document requires additional output
 *    classifications "without redevelopment", and the same argument applies to coffee
 *    types, bag types and reason codes. Code keys behaviour on the stable `code` column,
 *    never on a UUID or a display name. See docs/adr/0004-lookup-tables-over-enums.md.
 *
 * 2. EFFECTIVE-DATED VERSIONING for anything with a value that changes over time.
 *    M02 key control: "changing a tariff does not retrospectively alter invoices already
 *    raised under the old rate." Overlap is prevented by an EXCLUDE constraint in SQL —
 *    application-level checks race.
 */

// ── Organisation ─────────────────────────────────────────────────────────────

/**
 * A physical site. Present from day one with a single seeded row, so a second EthioStar
 * site never requires a migration of the operational tables.
 */
export const branch = pgTable(
  'branch',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    address: text('address'),
    city: text('city'),
    phone: text('phone'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_branch__code').on(t.code)],
)

// ── Geography ────────────────────────────────────────────────────────────────

export const region = pgTable(
  'region',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_region__code').on(t.code)],
)

/** Ethiopian third-level administrative division; coffee origin is recorded to this level. */
export const woreda = pgTable(
  'woreda',
  {
    id: uuid('id').primaryKey(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => region.id),
    code: text('code').notNull(),
    ...displayNames(),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_woreda__code').on(t.code),
    index('idx_woreda__region').on(t.regionId),
  ],
)

// ── Coffee master data ───────────────────────────────────────────────────────

/** washed / natural / semi-washed. */
export const coffeeType = pgTable(
  'coffee_type',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    description: text('description'),
    /**
     * Per-type override of the mass-balance tolerance. A natural sun-dried lot does not
     * behave like a washed one, and forcing one tolerance across both produces either
     * false exceptions or a tolerance too loose to catch anything.
     */
    massBalanceTolerancePct: percent('mass_balance_tolerance_pct'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_coffee_type__code').on(t.code)],
)

export const coffeeGrade = pgTable(
  'coffee_grade',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_coffee_grade__code').on(t.code)],
)

export const screenSize = pgTable(
  'screen_size',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_screen_size__code').on(t.code)],
)

export const certification = pgTable(
  'certification',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    issuingBody: text('issuing_body'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_certification__code').on(t.code)],
)

export const harvestYear = pgTable(
  'harvest_year',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    startsOn: calendarDate('starts_on').notNull(),
    endsOn: calendarDate('ends_on').notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_harvest_year__code').on(t.code),
    check('ck_harvest_year__range', sql`${t.endsOn} > ${t.startsOn}`),
  ],
)

/**
 * The four processing outputs (M15) — as CONFIGURABLE RECORDS.
 *
 * The M02 key control in its most literal form: "the four standard outputs ... defined as
 * configurable records so additional classifications can be added later without
 * redevelopment." A fifth classification is a row insert through the admin UI.
 *
 * Only `is_primary` carries special behaviour in code (the export-ready output that
 * downstream logic keys on). Everything else is data.
 */
export const outputClassification = pgTable(
  'output_classification',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    description: text('description'),
    /** True for exactly one row: Approved / Export-Ready. */
    isPrimary: boolean('is_primary').notNull().default(false),
    /** False for the three rejected classifications. */
    isExportReady: boolean('is_export_ready').notNull().default(false),
    /** Expected yield share, for the outlier check at capture. */
    expectedYieldPct: percent('expected_yield_pct'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_output_classification__code').on(t.code),
    // Exactly one primary output. Enforced as a partial unique index, so a second one is
    // rejected by the database rather than by a hopeful application check.
    uniqueIndex('uq_output_classification__single_primary')
      .on(t.isPrimary)
      .where(sql`${t.isPrimary} = true`),
  ],
)

// ── Bags (kesha) ─────────────────────────────────────────────────────────────

/**
 * A bag type. Its STANDARD NET WEIGHT is effective-dated in `bag_type_version`, because
 * suppliers change and a receipt printed last season must still reconcile against the
 * weight that applied then.
 */
export const bagType = pgTable(
  'bag_type',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    material: text('material'),
    /** ETHIOSTAR | CUSTOMER — customer-owned bags are returnable on dispatch (M13). */
    ownership: text('ownership').notNull().default('ETHIOSTAR'),
    isReturnable: boolean('is_returnable').notNull().default(false),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_bag_type__code').on(t.code),
    check('ck_bag_type__ownership', sql`${t.ownership} in ('ETHIOSTAR','CUSTOMER')`),
  ],
)

/**
 * Effective-dated standard net weight.
 *
 * The `EXCLUDE USING gist` no-overlap constraint is declared in SQL (migration 0004);
 * Drizzle cannot express it. Overlapping effective dates are the classic source of
 * "why was this priced at the old rate?", and application-level checks race.
 */
export const bagTypeVersion = pgTable(
  'bag_type_version',
  {
    id: uuid('id').primaryKey(),
    bagTypeId: uuid('bag_type_id')
      .notNull()
      .references(() => bagType.id),
    /** The ASSUMED weight. Actual weighed figures are always recorded separately. */
    standardNetWeightKg: weightKg('standard_net_weight_kg').notNull(),
    tareWeightKg: weightKg('tare_weight_kg'),
    /** Deviation beyond this flags the receipt for review. */
    weightTolerancePct: percent('weight_tolerance_pct'),
    ...effectivePeriod(),
    ...auditColumns(),
  },
  (t) => [
    index('idx_bag_type_version__type').on(t.bagTypeId, t.effectiveFrom.desc()),
    check(
      'ck_bag_type_version__range',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
)

/** Weight bands used to differentiate piece rates (M18). */
export const bagWeightClass = pgTable(
  'bag_weight_class',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    minWeightKg: weightKg('min_weight_kg').notNull(),
    maxWeightKg: weightKg('max_weight_kg'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_bag_weight_class__code').on(t.code),
    check(
      'ck_bag_weight_class__range',
      sql`${t.maxWeightKg} is null or ${t.maxWeightKg} > ${t.minWeightKg}`,
    ),
  ],
)
