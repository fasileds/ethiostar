import { pgTable, text, uuid, index, uniqueIndex, check, integer } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  appendOnlyColumns,
  occurrenceColumns,
  weightKg,
  instant,
  calendarDate,
  sourceReference,
} from '../helpers/columns'
import { branch, bagType } from './master-data'
import { customer } from './customer'
import { consignment } from './consignment'
import { storeSection } from './warehouse'

/**
 * M13 — Kesha (Bag) Tracking & Reconciliation.
 *
 * Kesha are the customer's property and are counted separately from the coffee inside them.
 * The client's problem is exact: bags arrive full, are emptied into processing, are refilled
 * with output, and the difference — damaged, retained, returned — is currently argued about
 * from memory.
 *
 * So this is an APPEND-ONLY ledger in the same shape as the stock ledger, with a rebuildable
 * balance projection. A count that can be edited is a count nobody trusts.
 */

export const keshaMovement = pgTable(
  'kesha_movement',
  {
    id: uuid('id').primaryKey(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    consignmentId: uuid('consignment_id').references(() => consignment.id),
    bagTypeId: uuid('bag_type_id').references(() => bagType.id),
    locationId: uuid('location_id').references(() => storeSection.id),

    /**
     * RECEIVED_FULL | EMPTIED | REFILLED | RETURNED_EMPTY | RETURNED_FULL
     * | DAMAGED | RETAINED | ADJUSTMENT
     */
    movementType: text('movement_type').notNull(),
    /** Signed: positive increases EthioStar's holding of the customer's bags. */
    keshaDelta: integer('kesha_delta').notNull(),
    /** Condition at the time — a damaged bag returned is not a good bag returned. */
    condition: text('condition').notNull().default('GOOD'),

    ...sourceReference(),
    reasonCode: text('reason_code'),
    note: text('note'),

    ...occurrenceColumns(),
    ...appendOnlyColumns(),
  },
  (t) => [
    index('idx_kesha_movement__customer').on(t.customerId, t.occurredAt),
    index('idx_kesha_movement__consignment').on(t.consignmentId),
    index('idx_kesha_movement__source').on(t.sourceType, t.sourceId),
    index('idx_kesha_movement__type').on(t.movementType, t.occurredAt),
    check(
      'ck_kesha_movement__type',
      sql`${t.movementType} in ('RECEIVED_FULL','EMPTIED','REFILLED','RETURNED_EMPTY','RETURNED_FULL','DAMAGED','RETAINED','ADJUSTMENT')`,
    ),
    check('ck_kesha_movement__condition', sql`${t.condition} in ('GOOD','DAMAGED','UNUSABLE')`),
    // A zero-delta movement records nothing and hides mistakes.
    check('ck_kesha_movement__delta_nonzero', sql`${t.keshaDelta} <> 0`),
    // An adjustment always says why. Every other type carries its own meaning.
    check(
      'ck_kesha_movement__adjustment_reason',
      sql`${t.movementType} <> 'ADJUSTMENT' or ${t.reasonCode} is not null`,
    ),
  ],
)

/**
 * The projection. Rebuildable from `kesha_movement` at any time — that is the point.
 *
 * `version` drives optimistic concurrency so two concurrent receipts cannot both read 100
 * and both write 150.
 */
export const keshaBalance = pgTable(
  'kesha_balance',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    bagTypeId: uuid('bag_type_id').references(() => bagType.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),

    /** In EthioStar's hands, full of the customer's coffee. */
    heldFull: integer('held_full').notNull().default(0),
    /** In EthioStar's hands, empty after processing. */
    heldEmpty: integer('held_empty').notNull().default(0),
    damaged: integer('damaged').notNull().default(0),
    returned: integer('returned').notNull().default(0),

    lastMovementAt: instant('last_movement_at'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_kesha_balance__key').on(t.customerId, t.bagTypeId, t.branchId),
    index('idx_kesha_balance__customer').on(t.customerId),
    check('ck_kesha_balance__held_full', sql`${t.heldFull} >= 0`),
    check('ck_kesha_balance__held_empty', sql`${t.heldEmpty} >= 0`),
  ],
)

/**
 * A physical count, and its variance against the ledger.
 *
 * The variance is the whole reason the module exists, so it is stored rather than recomputed:
 * "the ledger said 400, we counted 388, and here is who signed off on the twelve."
 */
export const keshaReconciliation = pgTable(
  'kesha_reconciliation',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    bagTypeId: uuid('bag_type_id').references(() => bagType.id),

    countedOn: calendarDate('counted_on').notNull(),
    /** DRAFT → COUNTED → REVIEWED → POSTED | CANCELLED */
    status: text('status').notNull().default('DRAFT'),

    expectedFull: integer('expected_full').notNull(),
    expectedEmpty: integer('expected_empty').notNull(),
    countedFull: integer('counted_full').notNull(),
    countedEmpty: integer('counted_empty').notNull(),
    /** Generated, so it can never disagree with its own inputs. */
    varianceFull: integer('variance_full').generatedAlwaysAs(sql`counted_full - expected_full`),
    varianceEmpty: integer('variance_empty').generatedAlwaysAs(
      sql`counted_empty - expected_empty`,
    ),
    damagedFound: integer('damaged_found').notNull().default(0),

    /** Approximate value of the variance, for the exception report. */
    estimatedValue: weightKg('estimated_value'),

    countedBy: uuid('counted_by').notNull(),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: instant('reviewed_at'),
    postedAt: instant('posted_at'),
    varianceReason: text('variance_reason'),
    customerRepName: text('customer_rep_name'),
    customerSignedAt: instant('customer_signed_at'),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_kesha_reconciliation__reference').on(t.reference),
    index('idx_kesha_reconciliation__customer').on(t.customerId, t.countedOn),
    index('idx_kesha_reconciliation__status').on(t.status),
    check(
      'ck_kesha_reconciliation__status',
      sql`${t.status} in ('DRAFT','COUNTED','REVIEWED','POSTED','CANCELLED')`,
    ),
    check(
      'ck_kesha_reconciliation__counts',
      sql`${t.countedFull} >= 0 and ${t.countedEmpty} >= 0`,
    ),
    // A posted reconciliation with a variance must explain it, or the count is just an
    // unexplained number the customer will dispute later.
    check(
      'ck_kesha_reconciliation__variance_explained',
      sql`${t.status} <> 'POSTED'
           or (counted_full = expected_full and counted_empty = expected_empty)
           or ${t.varianceReason} is not null`,
    ),
  ],
)
