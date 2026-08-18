import { pgTable, text, uuid, index, uniqueIndex, check, primaryKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  appendOnlyColumns,
  weightKg,
  keshaCount,
  instant,
  calendarDate,
} from '../helpers/columns'
import {
  branch,
  coffeeType,
  coffeeGrade,
  woreda,
  harvestYear,
  bagType,
  outputClassification,
} from './master-data'
import { storeSection } from './warehouse'

/**
 * The consignment spine — the operational backbone the client document describes as
 * "a single consignment reference [that] follows the coffee from the customer's request
 * letter ... onto the dispatch truck."
 *
 * Lives BELOW M11–M17 so the lifecycle exists in one place with one exhaustive test,
 * rather than being reimplemented six times with one of them permitting a skipped state.
 * See docs/adr/0003-consignment-spine-and-stock-ledger.md.
 */

export const consignment = pgTable(
  'consignment',
  {
    id: uuid('id').primaryKey(),
    /** Human-quotable reference on every printed document. */
    reference: text('reference').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    customerId: uuid('customer_id').notNull(),
    /** FK added by migration 0013 once delivery_request exists. */
    deliveryRequestId: uuid('delivery_request_id'),

    status: text('status').notNull().default('REQUESTED'),

    coffeeTypeId: uuid('coffee_type_id').references(() => coffeeType.id),
    originRegionId: uuid('origin_region_id'),
    originWoredaId: uuid('origin_woreda_id').references(() => woreda.id),
    harvestYearId: uuid('harvest_year_id').references(() => harvestYear.id),

    /** Declared by the customer on the request. */
    declaredQuantityKg: weightKg('declared_quantity_kg'),
    declaredKeshaCount: keshaCount('declared_kesha_count'),
    /** Confirmed at the gate — the figure the rest of the system depends on. */
    receivedQuantityKg: weightKg('received_quantity_kg'),
    receivedKeshaCount: keshaCount('received_kesha_count'),

    expectedArrivalOn: calendarDate('expected_arrival_on'),
    receivedAt: instant('received_at'),
    /**
     * Set at CONFIRMED RECEIPT. Consumed by ageing reports in Phase 1 and by M20 storage
     * charging in Phase 2 — recorded now because it cannot be backfilled: `created_at` is
     * the day the record was typed, not the day the coffee arrived.
     */
    storageStartDate: calendarDate('storage_start_date'),
    closedAt: instant('closed_at'),

    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_consignment__reference').on(t.reference),
    index('idx_consignment__customer').on(t.customerId, t.createdAt.desc()),
    // The operational worklist query: "what is at this stage".
    index('idx_consignment__status_customer').on(t.status, t.customerId, t.createdAt.desc()),
    index('idx_consignment__storage_start').on(t.storageStartDate),
    check(
      'ck_consignment__status',
      sql`${t.status} in ('REQUESTED','ACCEPTED','RECEIVED','STORED','SCHEDULED','IN_PROCESS',
                         'PROCESSED','ACCEPTED_BY_CUSTOMER','RELEASE_REQUESTED','DISPATCHED',
                         'CLOSED','CANCELLED')`,
    ),
  ],
)

/**
 * The legal transition table, AS DATA.
 *
 * Enforcement layer 3: a BEFORE UPDATE trigger validates every status change against this
 * table. It catches migrations, data-fix scripts and manual DBA intervention — which is
 * exactly when the application-level discipline breaks.
 */
export const consignmentTransition = pgTable(
  'consignment_transition',
  {
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    description: text('description'),
  },
  (t) => [primaryKey({ columns: [t.fromStatus, t.toStatus] })],
)

/** Append-only: every transition with its actor and timestamp. */
export const consignmentStatusHistory = pgTable(
  'consignment_status_history',
  {
    id: uuid('id').primaryKey(),
    consignmentId: uuid('consignment_id')
      .notNull()
      .references(() => consignment.id),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    occurredAt: instant('occurred_at').notNull(),
    actorId: uuid('actor_id').notNull(),
    reason: text('reason'),
    ...appendOnlyColumns(),
  },
  (t) => [
    index('idx_consignment_status_history__consignment').on(t.consignmentId, t.occurredAt),
  ],
)

/**
 * A lot — "a distinct, separately identifiable quantity of coffee within a consignment;
 * processing outputs become new lots linked to their parent."
 */
export const lot = pgTable(
  'lot',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    consignmentId: uuid('consignment_id')
      .notNull()
      .references(() => consignment.id),
    customerId: uuid('customer_id').notNull(),
    status: text('status').notNull().default('IN_STORE'),

    coffeeTypeId: uuid('coffee_type_id').references(() => coffeeType.id),
    coffeeGradeId: uuid('coffee_grade_id').references(() => coffeeGrade.id),
    bagTypeId: uuid('bag_type_id').references(() => bagType.id),
    /** Null for received lots; set for the four processing outputs. */
    outputClassificationId: uuid('output_classification_id').references(
      () => outputClassification.id,
    ),

    /** Original quantity. Current balance comes from the ledger, never from here. */
    initialQuantityKg: weightKg('initial_quantity_kg').notNull(),
    initialKeshaCount: keshaCount('initial_kesha_count').notNull(),

    /** Ageing and (Phase 2) storage charging both key on this. */
    storageStartDate: calendarDate('storage_start_date'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_lot__reference').on(t.reference),
    index('idx_lot__consignment').on(t.consignmentId),
    index('idx_lot__customer_status').on(t.customerId, t.status),
    index('idx_lot__output_classification').on(t.outputClassificationId),
    check(
      'ck_lot__status',
      sql`${t.status} in ('IN_STORE','RESERVED_FOR_JOB','CONSUMED','PRODUCED','ACCEPTED','DISPATCHED')`,
    ),
  ],
)

export const lotStatusHistory = pgTable(
  'lot_status_history',
  {
    id: uuid('id').primaryKey(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lot.id),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    occurredAt: instant('occurred_at').notNull(),
    actorId: uuid('actor_id').notNull(),
    reason: text('reason'),
    ...appendOnlyColumns(),
  },
  (t) => [index('idx_lot_status_history__lot').on(t.lotId, t.occurredAt)],
)

/**
 * Lineage as EDGES, not a parent_lot_id column.
 *
 * Costs nothing now and supports blending and re-processing later without a migration. The
 * coffee passport is a recursive CTE over this table — which is why an output lot appears
 * on its parent consignment's timeline.
 */
export const lotLineage = pgTable(
  'lot_lineage',
  {
    parentLotId: uuid('parent_lot_id')
      .notNull()
      .references(() => lot.id),
    childLotId: uuid('child_lot_id')
      .notNull()
      .references(() => lot.id),
    /** FK added by migration 0016 once job_order exists. */
    jobOrderId: uuid('job_order_id'),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.parentLotId, t.childLotId] }),
    index('idx_lot_lineage__child').on(t.childLotId),
    index('idx_lot_lineage__job').on(t.jobOrderId),
    // A lot cannot be its own parent.
    check('ck_lot_lineage__no_self', sql`${t.parentLotId} <> ${t.childLotId}`),
  ],
)

/** Current placement of a lot, for the "where is it?" question. Derived from the ledger. */
export const lotPlacement = pgTable(
  'lot_placement',
  {
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lot.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => storeSection.id),
    placedAt: instant('placed_at').notNull(),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.lotId, t.locationId] }),
    index('idx_lot_placement__location').on(t.locationId),
  ],
)
