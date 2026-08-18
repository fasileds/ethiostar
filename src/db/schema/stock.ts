import { pgTable, text, uuid, index, check, primaryKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  appendOnlyColumns,
  weightKg,
  keshaCount,
  instant,
  calendarDate,
} from '../helpers/columns'
import { lot, consignment } from './consignment'
import { storeSection } from './warehouse'
import { bagType } from './master-data'
import { reasonCode } from './reference'

/**
 * The stock ledger.
 *
 * `stock_movement` is APPEND-ONLY and is the SOURCE OF TRUTH. `stock_balance` is a
 * projection maintained in the same transaction, and can be dropped and rebuilt from the
 * ledger at any time. The reverse is impossible — and that asymmetry is the whole argument
 * for this design.
 *
 * docs/adr/0003-consignment-spine-and-stock-ledger.md
 */

export const stockMovement = pgTable(
  'stock_movement',
  {
    id: uuid('id').primaryKey(),

    /** When it physically happened. */
    occurredAt: instant('occurred_at').notNull(),
    /** When the system was told. These differ, and the gap is itself a signal. */
    recordedAt: instant('recorded_at')
      .notNull()
      .default(sql`now()`),

    movementType: text('movement_type').notNull(),

    lotId: uuid('lot_id')
      .notNull()
      .references(() => lot.id),
    /** Denormalised deliberately: every ledger query filters by customer. */
    customerId: uuid('customer_id').notNull(),
    consignmentId: uuid('consignment_id')
      .notNull()
      .references(() => consignment.id),
    /**
     * NOT NULL — the M12 key control, as a schema constraint rather than a habit:
     * "Every kilogram in the system must be at a defined location; unallocated stock is
     * not permitted."
     */
    locationId: uuid('location_id')
      .notNull()
      .references(() => storeSection.id),

    /** SIGNED: + increases, − decreases. */
    quantityKg: weightKg('quantity_kg').notNull(),
    keshaCount: keshaCount('kesha_count').notNull(),

    bagTypeId: uuid('bag_type_id').references(() => bagType.id),
    /** Mandatory for ADJUSTMENT_*, COUNT_VARIANCE and PROCESS_LOSS. */
    reasonCodeId: uuid('reason_code_id').references(() => reasonCode.id),

    /** The document that caused this movement. */
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),

    actorId: uuid('actor_id').notNull(),
    /** Second person on a weighing — the document puts weighbridge integration out of scope. */
    witnessId: uuid('witness_id'),
    narrative: text('narrative'),

    /** Groups every movement of one business operation. A job's rows sum to zero. */
    correlationId: uuid('correlation_id').notNull(),

    ...appendOnlyColumns(),
  },
  (t) => [
    // Ledger queries are always "this lot, in time order" or "this document".
    index('idx_stock_movement__lot_occurred').on(t.lotId, t.occurredAt.desc()),
    index('idx_stock_movement__source').on(t.sourceType, t.sourceId),
    index('idx_stock_movement__correlation').on(t.correlationId),
    index('idx_stock_movement__customer').on(t.customerId, t.occurredAt.desc()),
    index('idx_stock_movement__location').on(t.locationId, t.occurredAt.desc()),
    check(
      'ck_stock_movement__type',
      sql`${t.movementType} in ('RECEIPT','PLACEMENT','TRANSFER_OUT','TRANSFER_IN','ISSUE_TO_JOB',
                               'OUTPUT_FROM_JOB','PROCESS_LOSS','ADJUSTMENT_IN','ADJUSTMENT_OUT',
                               'DISPATCH_OUT','COUNT_VARIANCE')`,
    ),
    // A movement must change something.
    check('ck_stock_movement__non_zero', sql`${t.quantityKg} <> 0 or ${t.keshaCount} <> 0`),
    // Reason code mandatory where the domain requires it — belt and braces with the
    // domain check, because a data-fix script does not run the domain.
    check(
      'ck_stock_movement__reason_required',
      sql`${t.movementType} not in ('ADJUSTMENT_IN','ADJUSTMENT_OUT','COUNT_VARIANCE','PROCESS_LOSS')
          or ${t.reasonCodeId} is not null`,
    ),
  ],
)

/**
 * The balance projection.
 *
 * Maintained in the SAME transaction as the movement insert, via
 * `INSERT ... ON CONFLICT DO UPDATE SET quantity = quantity + EXCLUDED.quantity`, which
 * takes a row lock and therefore serialises concurrent movements on one (lot, location)
 * correctly.
 *
 * Summing the ledger on every page load will not survive a season of data — the portal
 * stock view is the hottest query in the system.
 */
export const stockBalance = pgTable(
  'stock_balance',
  {
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lot.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => storeSection.id),
    customerId: uuid('customer_id').notNull(),
    consignmentId: uuid('consignment_id')
      .notNull()
      .references(() => consignment.id),
    bagTypeId: uuid('bag_type_id').references(() => bagType.id),

    quantityKg: weightKg('quantity_kg').notNull().default('0'),
    keshaCount: keshaCount('kesha_count').notNull().default(0),

    /** The last movement folded in — lets the reconciliation job find drift precisely. */
    lastMovementId: uuid('last_movement_id'),
    updatedAt: instant('updated_at')
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.lotId, t.locationId] }),
    // The hottest path: a customer's stock position. Partial, so empty rows do not bloat it.
    index('idx_stock_balance__customer_lot')
      .on(t.customerId, t.lotId)
      .where(sql`${t.quantityKg} > 0`),
    index('idx_stock_balance__location')
      .on(t.locationId)
      .where(sql`${t.quantityKg} > 0`),
    index('idx_stock_balance__consignment').on(t.consignmentId),
    // You cannot hold negative coffee. Checked in the domain AND here, because a
    // data-fix script does not run the domain.
    check('ck_stock_balance__non_negative', sql`${t.quantityKg} >= 0 and ${t.keshaCount} >= 0`),
  ],
)

/** Header for a transfer between locations; the movements carry the detail. */
export const stockTransfer = pgTable(
  'stock_transfer',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    fromLocationId: uuid('from_location_id')
      .notNull()
      .references(() => storeSection.id),
    toLocationId: uuid('to_location_id')
      .notNull()
      .references(() => storeSection.id),
    occurredAt: instant('occurred_at').notNull(),
    reasonCodeId: uuid('reason_code_id').references(() => reasonCode.id),
    narrative: text('narrative'),
    correlationId: uuid('correlation_id').notNull(),
    ...auditColumns(),
  },
  (t) => [
    index('idx_stock_transfer__from').on(t.fromLocationId, t.occurredAt.desc()),
    index('idx_stock_transfer__to').on(t.toLocationId, t.occurredAt.desc()),
    check('ck_stock_transfer__distinct', sql`${t.fromLocationId} <> ${t.toLocationId}`),
  ],
)

/**
 * A stock adjustment — the highest-risk operation in the system (threat T2).
 * Requires the distinct `stock:adjust` permission and a mandatory reason code.
 */
export const stockAdjustment = pgTable(
  'stock_adjustment',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lot.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => storeSection.id),
    quantityKgDelta: weightKg('quantity_kg_delta').notNull(),
    keshaCountDelta: keshaCount('kesha_count_delta').notNull(),
    reasonCodeId: uuid('reason_code_id')
      .notNull()
      .references(() => reasonCode.id),
    narrative: text('narrative'),
    occurredAt: instant('occurred_at').notNull(),
    approvedBy: uuid('approved_by'),
    approvedAt: instant('approved_at'),
    correlationId: uuid('correlation_id').notNull(),
    ...auditColumns(),
  },
  (t) => [
    index('idx_stock_adjustment__lot').on(t.lotId, t.occurredAt.desc()),
    index('idx_stock_adjustment__occurred').on(t.occurredAt.desc()),
  ],
)

/** Physical count — expected vs counted, with the variance posted to the ledger. */
export const stockCount = pgTable(
  'stock_count',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => storeSection.id),
    countedOn: calendarDate('counted_on').notNull(),
    status: text('status').notNull().default('DRAFT'),
    countedBy: uuid('counted_by').notNull(),
    approvedBy: uuid('approved_by'),
    approvedAt: instant('approved_at'),
    ...auditColumns(),
  },
  (t) => [
    index('idx_stock_count__location').on(t.locationId, t.countedOn.desc()),
    check(
      'ck_stock_count__status',
      sql`${t.status} in ('DRAFT','COUNTED','APPROVED','CANCELLED')`,
    ),
  ],
)

export const stockCountLine = pgTable(
  'stock_count_line',
  {
    id: uuid('id').primaryKey(),
    countId: uuid('count_id')
      .notNull()
      .references(() => stockCount.id, { onDelete: 'cascade' }),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lot.id),
    /** Snapshot of the projection at count time — what the system believed. */
    expectedQuantityKg: weightKg('expected_quantity_kg').notNull(),
    expectedKeshaCount: keshaCount('expected_kesha_count').notNull(),
    /** What was physically found. */
    countedQuantityKg: weightKg('counted_quantity_kg').notNull(),
    countedKeshaCount: keshaCount('counted_kesha_count').notNull(),
    reasonCodeId: uuid('reason_code_id').references(() => reasonCode.id),
    narrative: text('narrative'),
    ...auditColumns(),
  },
  (t) => [index('idx_stock_count_line__count').on(t.countId)],
)
