import {
  pgTable,
  text,
  uuid,
  index,
  uniqueIndex,
  check,
  integer,
  boolean,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  appendOnlyColumns,
  occurrenceColumns,
  weightKg,
  keshaCount,
  percent,
  instant,
  calendarDate,
} from '../helpers/columns'
import { branch, coffeeType, coffeeGrade, outputClassification } from './master-data'
import { customer } from './customer'
import { consignment, lot } from './consignment'
import { machine, appointment } from './scheduling'
import { storeSection } from './warehouse'

/**
 * M15 — Coffee Processing & Sorting Operations.
 *
 * The mass-balance rule governs this whole module: input kilograms must equal the sum of
 * output kilograms plus recorded loss, within tolerance. Loss is a DESTINATION with a
 * positive quantity, not a negative issue — treating it as a second withdrawal double-counts
 * it against the input and makes every yield calculation wrong.
 * docs/architecture/03-domain-model.md §3.4
 */

/** A customer's request to have stored coffee processed. Precedes the job order. */
export const processingRequest = pgTable(
  'processing_request',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    consignmentId: uuid('consignment_id').references(() => consignment.id),

    /** DRAFT → SUBMITTED → APPROVED | REJECTED → SCHEDULED → COMPLETED | CANCELLED */
    status: text('status').notNull().default('DRAFT'),

    /** SORTING | HULLING | GRADING | CLEANING | POLISHING */
    serviceType: text('service_type').notNull(),
    requestedQuantityKg: weightKg('requested_quantity_kg').notNull(),
    requestedKeshaCount: keshaCount('requested_kesha_count'),
    /** What the customer wants out — free text in Phase 1, specification in Phase 2. */
    outputSpecification: text('output_specification'),
    preferredStartOn: calendarDate('preferred_start_on'),
    urgency: text('urgency').notNull().default('NORMAL'),

    submittedAt: instant('submitted_at'),
    approvedBy: uuid('approved_by'),
    approvedAt: instant('approved_at'),
    rejectionReason: text('rejection_reason'),
    appointmentId: uuid('appointment_id').references(() => appointment.id),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_processing_request__reference').on(t.reference),
    index('idx_processing_request__customer').on(t.customerId, t.createdAt),
    index('idx_processing_request__status').on(t.status),
    index('idx_processing_request__consignment').on(t.consignmentId),
    check(
      'ck_processing_request__status',
      sql`${t.status} in ('DRAFT','SUBMITTED','APPROVED','REJECTED','SCHEDULED','COMPLETED','CANCELLED')`,
    ),
    check(
      'ck_processing_request__service',
      sql`${t.serviceType} in ('SORTING','HULLING','GRADING','CLEANING','POLISHING')`,
    ),
    check('ck_processing_request__urgency', sql`${t.urgency} in ('LOW','NORMAL','HIGH')`),
    check('ck_processing_request__quantity', sql`${t.requestedQuantityKg} > 0`),
  ],
)

/**
 * The job order — one run on one machine.
 *
 * `massBalanceStatus` is stored, not derived, for the same reason variance is stored on a
 * goods receipt: the tolerance in force when the job closed is a fact about that job. A later
 * tolerance change must not silently make a historic exception disappear.
 */
export const jobOrder = pgTable(
  'job_order',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    consignmentId: uuid('consignment_id')
      .notNull()
      .references(() => consignment.id),
    processingRequestId: uuid('processing_request_id').references(() => processingRequest.id),
    appointmentId: uuid('appointment_id').references(() => appointment.id),
    machineId: uuid('machine_id').references(() => machine.id),

    /** PLANNED → RELEASED → IN_PROGRESS → (PAUSED ⇄ IN_PROGRESS) → COMPLETED → CLOSED | CANCELLED */
    status: text('status').notNull().default('PLANNED'),
    serviceType: text('service_type').notNull(),

    plannedInputKg: weightKg('planned_input_kg').notNull(),
    plannedKeshaCount: keshaCount('planned_kesha_count'),
    /** Totals maintained from the line tables; the lines remain the source of truth. */
    actualInputKg: weightKg('actual_input_kg'),
    actualOutputKg: weightKg('actual_output_kg'),
    actualLossKg: weightKg('actual_loss_kg'),
    yieldPct: percent('yield_pct'),
    lossPct: percent('loss_pct'),

    /** BALANCED | WITHIN_TOLERANCE | EXCEPTION — frozen at close. */
    massBalanceStatus: text('mass_balance_status'),
    toleranceAppliedPct: percent('tolerance_applied_pct'),
    varianceKg: weightKg('variance_kg'),
    varianceApprovedBy: uuid('variance_approved_by'),
    varianceApprovedAt: instant('variance_approved_at'),
    varianceReason: text('variance_reason'),

    scheduledStartAt: instant('scheduled_start_at'),
    startedAt: instant('started_at'),
    pausedAt: instant('paused_at'),
    completedAt: instant('completed_at'),
    closedAt: instant('closed_at'),
    cancelledAt: instant('cancelled_at'),
    cancelledReason: text('cancelled_reason'),

    supervisorId: uuid('supervisor_id'),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_job_order__reference').on(t.reference),
    index('idx_job_order__consignment').on(t.consignmentId),
    index('idx_job_order__customer').on(t.customerId, t.createdAt),
    index('idx_job_order__status').on(t.status),
    index('idx_job_order__machine_day').on(t.machineId, t.scheduledStartAt),
    // The "on the line now" query, which the dashboard runs on every load.
    index('idx_job_order__running')
      .on(t.startedAt)
      .where(sql`${t.status} in ('RELEASED','IN_PROGRESS','PAUSED')`),
    check(
      'ck_job_order__status',
      sql`${t.status} in ('PLANNED','RELEASED','IN_PROGRESS','PAUSED','COMPLETED','CLOSED','CANCELLED')`,
    ),
    check(
      'ck_job_order__mass_balance',
      sql`${t.massBalanceStatus} is null or ${t.massBalanceStatus} in ('BALANCED','WITHIN_TOLERANCE','EXCEPTION')`,
    ),
    check('ck_job_order__planned_input', sql`${t.plannedInputKg} > 0`),
    // A closed job must have been balanced. This is the mass-balance control expressed where
    // it cannot be skipped by whichever screen happens to be closing the job.
    check(
      'ck_job_order__closed_is_balanced',
      sql`${t.status} <> 'CLOSED' or ${t.massBalanceStatus} is not null`,
    ),
  ],
)

/** Coffee issued INTO a job. Each line withdraws from a lot. */
export const jobOrderInput = pgTable(
  'job_order_input',
  {
    id: uuid('id').primaryKey(),
    jobOrderId: uuid('job_order_id')
      .notNull()
      .references(() => jobOrder.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lot.id),
    locationId: uuid('location_id').references(() => storeSection.id),
    quantityKg: weightKg('quantity_kg').notNull(),
    keshaCount: keshaCount('kesha_count'),
    coffeeTypeId: uuid('coffee_type_id').references(() => coffeeType.id),
    coffeeGradeId: uuid('coffee_grade_id').references(() => coffeeGrade.id),
    /** The ledger row this line wrote. Null until the issue is posted. */
    stockMovementId: uuid('stock_movement_id'),
    issuedAt: instant('issued_at'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_job_order_input__no').on(t.jobOrderId, t.lineNo),
    index('idx_job_order_input__job').on(t.jobOrderId),
    index('idx_job_order_input__lot').on(t.lotId),
    check('ck_job_order_input__quantity', sql`${t.quantityKg} > 0`),
  ],
)

/**
 * Coffee produced BY a job, including loss.
 *
 * `isLoss` distinguishes a loss line from a product line. Both are positive quantities, both
 * are destinations. The mass balance is: sum(inputs) = sum(outputs, loss included).
 */
export const jobOrderOutput = pgTable(
  'job_order_output',
  {
    id: uuid('id').primaryKey(),
    jobOrderId: uuid('job_order_id')
      .notNull()
      .references(() => jobOrder.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    /** PRIMARY | SECONDARY | REJECT | HUSK | DUST — the graded result. */
    classificationId: uuid('classification_id').references(() => outputClassification.id),
    /** True for the loss line. Routed to the warehouse's loss account section. */
    isLoss: boolean('is_loss').notNull().default(false),

    quantityKg: weightKg('quantity_kg').notNull(),
    keshaCount: keshaCount('kesha_count'),
    percentOfInput: percent('percent_of_input'),

    /** The lot this output became — a NEW lot, with lineage back to the inputs. */
    lotId: uuid('lot_id').references(() => lot.id),
    locationId: uuid('location_id').references(() => storeSection.id),
    coffeeGradeId: uuid('coffee_grade_id').references(() => coffeeGrade.id),
    stockMovementId: uuid('stock_movement_id'),
    producedAt: instant('produced_at'),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_job_order_output__no').on(t.jobOrderId, t.lineNo),
    index('idx_job_order_output__job').on(t.jobOrderId),
    index('idx_job_order_output__lot').on(t.lotId),
    check('ck_job_order_output__quantity', sql`${t.quantityKg} >= 0`),
  ],
)

/**
 * Shift-level production readings, append-only.
 *
 * A job spanning three shifts needs per-shift throughput or the labour and delay analysis
 * has nothing to work with.
 */
export const jobProductionLog = pgTable(
  'job_production_log',
  {
    id: uuid('id').primaryKey(),
    jobOrderId: uuid('job_order_id')
      .notNull()
      .references(() => jobOrder.id, { onDelete: 'cascade' }),
    shiftCode: text('shift_code'),
    loggedOn: calendarDate('logged_on').notNull(),
    processedKg: weightKg('processed_kg').notNull(),
    processedKesha: keshaCount('processed_kesha'),
    runMinutes: integer('run_minutes'),
    downtimeMinutes: integer('downtime_minutes').notNull().default(0),
    downtimeReason: text('downtime_reason'),
    operatorNote: text('operator_note'),
    ...occurrenceColumns(),
    ...appendOnlyColumns(),
  },
  (t) => [
    index('idx_job_production_log__job').on(t.jobOrderId, t.loggedOn),
    check('ck_job_production_log__processed', sql`${t.processedKg} >= 0`),
    check(
      'ck_job_production_log__downtime_reason',
      sql`${t.downtimeMinutes} = 0 or ${t.downtimeReason} is not null`,
    ),
  ],
)

/** Append-only status trail for a job order. */
export const jobOrderStatusHistory = pgTable(
  'job_order_status_history',
  {
    id: uuid('id').primaryKey(),
    jobOrderId: uuid('job_order_id')
      .notNull()
      .references(() => jobOrder.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    note: text('note'),
    changedAt: instant('changed_at')
      .notNull()
      .default(sql`now()`),
    changedBy: uuid('changed_by'),
  },
  (t) => [index('idx_job_order_status_history__job').on(t.jobOrderId, t.changedAt)],
)
