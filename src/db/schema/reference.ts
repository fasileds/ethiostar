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
import { auditColumns, activeFlag, displayNames, calendarDate } from '../helpers/columns'

/**
 * M02 continued — reference data used by the operational and support modules.
 *
 * Reason codes matter more than they look. Every stock adjustment, delay, process loss and
 * bag condemnation must carry one, because "unexplained variance" is precisely what the
 * exception register exists to surface. A free-text reason cannot be reported on.
 */

// ── Customer classification and KYC (M08) ────────────────────────────────────

/** exporter / supplier / union / cooperative / individual. */
export const businessType = pgTable(
  'business_type',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_business_type__code').on(t.code)],
)

/** Trade licence, TIN certificate, VAT certificate, export licence, and so on. */
export const kycDocumentType = pgTable(
  'kyc_document_type',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    description: text('description'),
    /** Whether this document carries an expiry date that must be tracked. */
    hasExpiry: boolean('has_expiry').notNull().default(false),
    /** Days before expiry at which the reminder job fires. */
    expiryWarningDays: integer('expiry_warning_days').notNull().default(30),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_kyc_document_type__code').on(t.code)],
)

/**
 * The configurable checklist: which documents are mandatory for which business type.
 *
 * M08 key control: "An application cannot be approved while any mandatory document is
 * unverified or expired." That rule reads this table, so EthioStar changes the checklist
 * without a release.
 */
export const kycDocumentRequirement = pgTable(
  'kyc_document_requirement',
  {
    id: uuid('id').primaryKey(),
    businessTypeId: uuid('business_type_id')
      .notNull()
      .references(() => businessType.id, { onDelete: 'cascade' }),
    documentTypeId: uuid('document_type_id')
      .notNull()
      .references(() => kycDocumentType.id, { onDelete: 'restrict' }),
    isMandatory: boolean('is_mandatory').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_kyc_document_requirement__pair').on(t.businessTypeId, t.documentTypeId),
    index('idx_kyc_document_requirement__business_type').on(t.businessTypeId),
  ],
)

// ── Reason codes ─────────────────────────────────────────────────────────────

/**
 * Categories keep one table serving every module while preventing a delay reason being
 * selected for a stock adjustment.
 */
export const reasonCodeCategory = pgTable(
  'reason_code_category',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_reason_code_category__code').on(t.code)],
)

export const reasonCode = pgTable(
  'reason_code',
  {
    id: uuid('id').primaryKey(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => reasonCodeCategory.id),
    code: text('code').notNull(),
    ...displayNames(),
    description: text('description'),
    /**
     * Whether choosing this code obliges the user to type an explanation as well.
     * "Other" always does; a specific cause usually does not.
     */
    requiresNarrative: boolean('requires_narrative').notNull().default(false),
    /** Surfaces on the exception register even when within tolerance. */
    isException: boolean('is_exception').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_reason_code__code').on(t.code),
    index('idx_reason_code__category').on(t.categoryId, t.sortOrder),
  ],
)

// ── Labour and shifts (M18) ──────────────────────────────────────────────────

/**
 * Unloading from truck, loading to line, loading to truck, stacking, re-bagging.
 *
 * `derivedFrom` is the M18 key control expressed as data: it names the operational event
 * whose confirmed count produces this activity. There is no path by which a labour
 * quantity is typed in by hand.
 */
export const labourActivityType = pgTable(
  'labour_activity_type',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    description: text('description'),
    /** The domain event whose confirmed kesha count drives this activity. */
    derivedFromEvent: text('derived_from_event').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_labour_activity_type__code').on(t.code)],
)

export const shift = pgTable(
  'shift',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    /** Local wall-clock times, in the plant's timezone. */
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    isNightShift: boolean('is_night_shift').notNull().default(false),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_shift__code').on(t.code),
    check('ck_shift__starts_at', sql`${t.startsAt} ~ '^[0-2][0-9]:[0-5][0-9]$'`),
    check('ck_shift__ends_at', sql`${t.endsAt} ~ '^[0-2][0-9]:[0-5][0-9]$'`),
  ],
)

/** Public holidays — drive the holiday premium in the piece-rate calculation. */
export const holiday = pgTable(
  'holiday',
  {
    id: uuid('id').primaryKey(),
    observedOn: calendarDate('observed_on').notNull(),
    ...displayNames(),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_holiday__date').on(t.observedOn)],
)

// ── Units ────────────────────────────────────────────────────────────────────

/**
 * Kilogram is the base unit; kesha is the counted unit. This table exists for display and
 * for document rendering — NOT as a conversion engine. Converting a recorded weight through
 * a units table is how a weight gets silently derived from a bag count, which the M11
 * control forbids.
 */
export const unitOfMeasure = pgTable(
  'unit_of_measure',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    symbol: text('symbol').notNull(),
    decimalPlaces: integer('decimal_places').notNull().default(3),
    isBaseUnit: boolean('is_base_unit').notNull().default(false),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_unit_of_measure__code').on(t.code)],
)
