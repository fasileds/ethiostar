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
  displayNames,
  weightKg,
  keshaCount,
  instant,
  calendarDate,
  percent,
} from '../helpers/columns'
import { branch } from './master-data'
import { customer } from './customer'
import { consignment } from './consignment'

/**
 * M14 — Processing Appointment Scheduling.
 *
 * The client's problem, stated plainly: a delay on one line pushes every appointment behind
 * it, and today nobody finds out until the customer arrives. So the schedule is modelled as
 * bookings against a machine's finite daily capacity, and a delay is a first-class record
 * that the cascade calculation reads — see core `delay-cascade.ts`.
 *
 * Capacity is per machine per day, in BOTH units, because a sorting line is limited by
 * throughput in kilograms while the yard is limited by bags it can stage.
 */

export const machine = pgTable(
  'machine',
  {
    id: uuid('id').primaryKey(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    code: text('code').notNull(),
    ...displayNames(),
    /** SORTER | HULLER | GRADER | CLEANER | POLISHER */
    machineType: text('machine_type').notNull(),
    manufacturer: text('manufacturer'),
    modelNo: text('model_no'),
    serialNo: text('serial_no'),
    commissionedOn: calendarDate('commissioned_on'),

    /** Nameplate throughput. The planning figure, before efficiency. */
    ratedCapacityKgPerHour: weightKg('rated_capacity_kg_per_hour').notNull(),
    /** Observed efficiency, 0–1. What scheduling actually multiplies by. */
    efficiencyFactor: percent('efficiency_factor').notNull().default('0.850'),

    /** AVAILABLE | RUNNING | MAINTENANCE | BREAKDOWN | RETIRED */
    status: text('status').notNull().default('AVAILABLE'),
    statusNote: text('status_note'),
    lastMaintenanceOn: calendarDate('last_maintenance_on'),
    nextMaintenanceOn: calendarDate('next_maintenance_on'),

    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_machine__code').on(t.code),
    index('idx_machine__branch').on(t.branchId, t.status),
    check(
      'ck_machine__status',
      sql`${t.status} in ('AVAILABLE','RUNNING','MAINTENANCE','BREAKDOWN','RETIRED')`,
    ),
    check('ck_machine__capacity', sql`${t.ratedCapacityKgPerHour} > 0`),
    check(
      'ck_machine__efficiency',
      sql`${t.efficiencyFactor} > 0 and ${t.efficiencyFactor} <= 1`,
    ),
  ],
)

/**
 * What a machine can take on one day.
 *
 * A row per machine per day rather than a computed rule, because the real answer is edited
 * constantly: a half-day for maintenance, a public holiday, a shift added for a rush. A rule
 * engine that has to model all of that is harder to reason about than a row an operator can
 * see and change.
 */
export const machineCapacityDay = pgTable(
  'machine_capacity_day',
  {
    id: uuid('id').primaryKey(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machine.id, { onDelete: 'cascade' }),
    capacityOn: calendarDate('capacity_on').notNull(),
    availableHours: percent('available_hours').notNull().default('8.000'),
    capacityKg: weightKg('capacity_kg').notNull(),
    capacityKesha: keshaCount('capacity_kesha'),
    /** Set when the day is closed to booking — holiday, planned maintenance. */
    isBlocked: boolean('is_blocked').notNull().default(false),
    blockedReason: text('blocked_reason'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_machine_capacity_day__pair').on(t.machineId, t.capacityOn),
    index('idx_machine_capacity_day__date').on(t.capacityOn),
    check('ck_machine_capacity_day__capacity', sql`${t.capacityKg} >= 0`),
    check(
      'ck_machine_capacity_day__blocked_reason',
      sql`not ${t.isBlocked} or ${t.blockedReason} is not null`,
    ),
  ],
)

/**
 * A booked slot.
 *
 * `sequenceNo` orders appointments within a machine-day. It is what the cascade walks when a
 * delay is recorded: everything after position N moves, everything before it does not.
 */
export const appointment = pgTable(
  'appointment',
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
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machine.id),

    scheduledOn: calendarDate('scheduled_on').notNull(),
    scheduledStartAt: instant('scheduled_start_at').notNull(),
    scheduledEndAt: instant('scheduled_end_at').notNull(),
    sequenceNo: integer('sequence_no').notNull(),

    plannedQuantityKg: weightKg('planned_quantity_kg').notNull(),
    plannedKeshaCount: keshaCount('planned_kesha_count'),
    estimatedHours: percent('estimated_hours'),

    /** REQUESTED → CONFIRMED → IN_PROGRESS → COMPLETED | CANCELLED | NO_SHOW; also RESCHEDULED. */
    status: text('status').notNull().default('REQUESTED'),

    /** Set when a cascade moved this appointment, so the customer can be told why. */
    rescheduledFromAt: instant('rescheduled_from_at'),
    rescheduleReason: text('reschedule_reason'),
    /** How far this slipped, in minutes. Cumulative across reschedules. */
    cumulativeDelayMinutes: integer('cumulative_delay_minutes').notNull().default(0),

    confirmedAt: instant('confirmed_at'),
    startedAt: instant('started_at'),
    completedAt: instant('completed_at'),
    cancelledAt: instant('cancelled_at'),
    cancelledReason: text('cancelled_reason'),

    customerNotifiedAt: instant('customer_notified_at'),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_appointment__reference').on(t.reference),
    // Position within a machine-day is unique among live appointments. Cancelled ones keep
    // their number, so the constraint is partial.
    uniqueIndex('uq_appointment__slot')
      .on(t.machineId, t.scheduledOn, t.sequenceNo)
      .where(sql`${t.status} not in ('CANCELLED','NO_SHOW','RESCHEDULED')`),
    index('idx_appointment__day').on(t.scheduledOn, t.machineId),
    index('idx_appointment__customer').on(t.customerId, t.scheduledOn),
    index('idx_appointment__consignment').on(t.consignmentId),
    index('idx_appointment__status').on(t.status, t.scheduledOn),
    check(
      'ck_appointment__status',
      sql`${t.status} in ('REQUESTED','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW','RESCHEDULED')`,
    ),
    check('ck_appointment__window', sql`${t.scheduledEndAt} > ${t.scheduledStartAt}`),
    check('ck_appointment__quantity', sql`${t.plannedQuantityKg} > 0`),
  ],
)

/**
 * A recorded delay, and the cascade it caused.
 *
 * Kept as its own record rather than a note on the appointment because the analysis the
 * client wants — which machine, which cause, how often — is a query over these rows.
 */
export const scheduleDelay = pgTable(
  'schedule_delay',
  {
    id: uuid('id').primaryKey(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machine.id),
    appointmentId: uuid('appointment_id').references(() => appointment.id),
    occurredOn: calendarDate('occurred_on').notNull(),
    delayMinutes: integer('delay_minutes').notNull(),
    /** BREAKDOWN | MAINTENANCE | POWER | LABOUR | MATERIAL | CUSTOMER_LATE | OTHER */
    causeCode: text('cause_code').notNull(),
    description: text('description'),
    /** How many downstream appointments the cascade moved. */
    affectedAppointments: integer('affected_appointments').notNull().default(0),
    reportedBy: uuid('reported_by').notNull(),
    reportedAt: instant('reported_at')
      .notNull()
      .default(sql`now()`),
    resolvedAt: instant('resolved_at'),
    ...auditColumns(),
  },
  (t) => [
    index('idx_schedule_delay__machine').on(t.machineId, t.occurredOn),
    index('idx_schedule_delay__cause').on(t.causeCode, t.occurredOn),
    check('ck_schedule_delay__minutes', sql`${t.delayMinutes} > 0`),
  ],
)

/** Append-only status trail for an appointment. */
export const appointmentStatusHistory = pgTable(
  'appointment_status_history',
  {
    id: uuid('id').primaryKey(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointment.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    note: text('note'),
    changedAt: instant('changed_at')
      .notNull()
      .default(sql`now()`),
    changedBy: uuid('changed_by'),
  },
  (t) => [
    index('idx_appointment_status_history__appointment').on(t.appointmentId, t.changedAt),
  ],
)
