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
  activeFlag,
  weightKg,
  keshaCount,
  moneyAmount,
  currency,
  instant,
  calendarDate,
} from '../helpers/columns'
import { branch } from './master-data'
import { labourActivityType, shift } from './reference'
import { jobOrder } from './processing'

/**
 * M18 — Labour & Workforce Management.
 *
 * Daily labourers sorting by hand, paid by piece rate. The client's pain is that the count a
 * worker claims, the count a supervisor observed, and the count that gets paid are three
 * different numbers held in three places.
 *
 * So attendance, output and pay are separate records with an explicit approval step between
 * output and pay. Pay is CALCULATED from an approved output row against a dated rate — never
 * typed — which is what makes a payroll dispute resolvable.
 */

export const labourWorker = pgTable(
  'labour_worker',
  {
    id: uuid('id').primaryKey(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    /** Payroll number. Printed on the worker's card. */
    workerCode: text('worker_code').notNull(),
    fullName: text('full_name').notNull(),
    fullNameAm: text('full_name_am'),
    gender: text('gender'),
    phone: text('phone'),
    idDocumentNo: text('id_document_no'),

    /** DAILY | CONTRACT | PERMANENT */
    engagementType: text('engagement_type').notNull().default('DAILY'),
    /** The activity this worker is normally assigned to. */
    defaultActivityTypeId: uuid('default_activity_type_id').references(
      () => labourActivityType.id,
    ),
    engagedOn: calendarDate('engaged_on'),
    releasedOn: calendarDate('released_on'),

    bankAccountNo: text('bank_account_no'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_labour_worker__code').on(t.workerCode),
    index('idx_labour_worker__branch').on(t.branchId, t.isActive),
    index('idx_labour_worker__name').on(t.fullName),
    check(
      'ck_labour_worker__engagement',
      sql`${t.engagementType} in ('DAILY','CONTRACT','PERMANENT')`,
    ),
  ],
)

/** A crew — the unit a supervisor actually manages and assigns. */
export const labourCrew = pgTable(
  'labour_crew',
  {
    id: uuid('id').primaryKey(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    supervisorId: uuid('supervisor_id'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_labour_crew__code').on(t.code),
    index('idx_labour_crew__branch').on(t.branchId),
  ],
)

export const labourCrewMember = pgTable(
  'labour_crew_member',
  {
    id: uuid('id').primaryKey(),
    crewId: uuid('crew_id')
      .notNull()
      .references(() => labourCrew.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => labourWorker.id),
    joinedOn: calendarDate('joined_on').notNull(),
    leftOn: calendarDate('left_on'),
    ...auditColumns(),
  },
  (t) => [
    // A worker belongs to one crew at a time. Overlapping membership makes the output
    // attribution ambiguous, which is exactly the dispute this module exists to prevent.
    uniqueIndex('uq_labour_crew_member__current')
      .on(t.workerId)
      .where(sql`${t.leftOn} is null`),
    index('idx_labour_crew_member__crew').on(t.crewId),
  ],
)

/**
 * The piece rate in force, effective-dated.
 *
 * A rate change must never restate what was already earned, so pay records copy the rate they
 * used. This table answers "what was the rate on the 14th", nothing more.
 */
export const labourRate = pgTable(
  'labour_rate',
  {
    id: uuid('id').primaryKey(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    activityTypeId: uuid('activity_type_id')
      .notNull()
      .references(() => labourActivityType.id),
    /** PER_KG | PER_KESHA | PER_DAY | PER_HOUR */
    rateBasis: text('rate_basis').notNull(),
    rateAmount: moneyAmount('rate_amount').notNull(),
    currency: currency(),
    effectiveFrom: calendarDate('effective_from').notNull(),
    effectiveTo: calendarDate('effective_to'),
    approvedBy: uuid('approved_by'),
    ...auditColumns(),
  },
  (t) => [
    index('idx_labour_rate__lookup').on(t.activityTypeId, t.branchId, t.effectiveFrom),
    check(
      'ck_labour_rate__basis',
      sql`${t.rateBasis} in ('PER_KG','PER_KESHA','PER_DAY','PER_HOUR')`,
    ),
    check('ck_labour_rate__amount', sql`${t.rateAmount} >= 0`),
    check(
      'ck_labour_rate__period',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
)

/** Attendance. One row per worker per day per shift. */
export const labourAttendance = pgTable(
  'labour_attendance',
  {
    id: uuid('id').primaryKey(),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => labourWorker.id),
    crewId: uuid('crew_id').references(() => labourCrew.id),
    attendanceOn: calendarDate('attendance_on').notNull(),
    shiftId: uuid('shift_id').references(() => shift.id),

    checkInAt: instant('check_in_at'),
    checkOutAt: instant('check_out_at'),
    /** PRESENT | ABSENT | LATE | HALF_DAY | LEAVE */
    status: text('status').notNull().default('PRESENT'),
    hoursWorked: moneyAmount('hours_worked'),
    absenceReason: text('absence_reason'),
    recordedBy: uuid('recorded_by').notNull(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_labour_attendance__day').on(t.workerId, t.attendanceOn, t.shiftId),
    index('idx_labour_attendance__day').on(t.attendanceOn, t.status),
    index('idx_labour_attendance__crew').on(t.crewId, t.attendanceOn),
    check(
      'ck_labour_attendance__status',
      sql`${t.status} in ('PRESENT','ABSENT','LATE','HALF_DAY','LEAVE')`,
    ),
    check(
      'ck_labour_attendance__times',
      sql`${t.checkOutAt} is null or ${t.checkInAt} is null or ${t.checkOutAt} >= ${t.checkInAt}`,
    ),
  ],
)

/**
 * What a worker produced, and what it is worth.
 *
 * `calculatedAmount` is derived by the piece-rate calculation from the rate copied into
 * `rateAmount`. Both are stored: the amount so payroll is reproducible, the rate so the
 * amount is explicable. Neither is ever typed by a user.
 */
export const labourOutput = pgTable(
  'labour_output',
  {
    id: uuid('id').primaryKey(),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => labourWorker.id),
    crewId: uuid('crew_id').references(() => labourCrew.id),
    jobOrderId: uuid('job_order_id').references(() => jobOrder.id),
    activityTypeId: uuid('activity_type_id')
      .notNull()
      .references(() => labourActivityType.id),
    producedOn: calendarDate('produced_on').notNull(),
    shiftId: uuid('shift_id').references(() => shift.id),

    quantityKg: weightKg('quantity_kg'),
    keshaCount: keshaCount('kesha_count'),
    hoursWorked: moneyAmount('hours_worked'),

    /** The rate applied, copied at approval so a later rate change cannot restate this. */
    rateId: uuid('rate_id').references(() => labourRate.id),
    rateBasis: text('rate_basis'),
    rateAmount: moneyAmount('rate_amount'),
    calculatedAmount: moneyAmount('calculated_amount'),
    currency: currency(),

    /** RECORDED → APPROVED → PAID | REJECTED */
    status: text('status').notNull().default('RECORDED'),
    recordedBy: uuid('recorded_by').notNull(),
    approvedBy: uuid('approved_by'),
    approvedAt: instant('approved_at'),
    rejectionReason: text('rejection_reason'),
    /** True where a supervisor's count differs from the worker's claim. */
    isDisputed: boolean('is_disputed').notNull().default(false),
    disputeNote: text('dispute_note'),
    ...auditColumns(),
  },
  (t) => [
    index('idx_labour_output__worker').on(t.workerId, t.producedOn),
    index('idx_labour_output__job').on(t.jobOrderId),
    index('idx_labour_output__day').on(t.producedOn, t.status),
    index('idx_labour_output__approval')
      .on(t.producedOn)
      .where(sql`${t.status} = 'RECORDED'`),
    check(
      'ck_labour_output__status',
      sql`${t.status} in ('RECORDED','APPROVED','PAID','REJECTED')`,
    ),
    // Something must have been produced, or there is nothing to pay for.
    check(
      'ck_labour_output__has_quantity',
      sql`${t.quantityKg} is not null or ${t.keshaCount} is not null or ${t.hoursWorked} is not null`,
    ),
    // An approved row must carry the rate it was valued at. Approving an unvalued row is how
    // a payroll dispute becomes unresolvable.
    check(
      'ck_labour_output__approved_is_priced',
      sql`${t.status} not in ('APPROVED','PAID') or (${t.rateAmount} is not null and ${t.calculatedAmount} is not null)`,
    ),
  ],
)

/**
 * A payroll run — a frozen set of approved outputs.
 *
 * Phase 1 computes and freezes it; M20 (Phase 2) pays against it. Freezing now means the
 * Phase 2 payment lands on a period that cannot have shifted underneath it.
 */
export const labourPayrollPeriod = pgTable(
  'labour_payroll_period',
  {
    id: uuid('id').primaryKey(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    reference: text('reference').notNull(),
    periodStartOn: calendarDate('period_start_on').notNull(),
    periodEndOn: calendarDate('period_end_on').notNull(),
    /** OPEN → CALCULATED → APPROVED → CLOSED */
    status: text('status').notNull().default('OPEN'),
    workerCount: integer('worker_count').notNull().default(0),
    totalAmount: moneyAmount('total_amount'),
    currency: currency(),
    calculatedAt: instant('calculated_at'),
    approvedBy: uuid('approved_by'),
    approvedAt: instant('approved_at'),
    closedAt: instant('closed_at'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_labour_payroll_period__reference').on(t.reference),
    index('idx_labour_payroll_period__range').on(t.branchId, t.periodStartOn),
    check(
      'ck_labour_payroll_period__status',
      sql`${t.status} in ('OPEN','CALCULATED','APPROVED','CLOSED')`,
    ),
    check('ck_labour_payroll_period__range', sql`${t.periodEndOn} >= ${t.periodStartOn}`),
  ],
)
