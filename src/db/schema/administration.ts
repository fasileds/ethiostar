import {
  pgTable,
  text,
  uuid,
  integer,
  jsonb,
  index,
  check,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { instant } from '../helpers/columns'

/**
 * Job queue (part of M23's infrastructure).
 *
 * Postgres-backed, claimed with FOR UPDATE SKIP LOCKED. No Redis, no broker: one database
 * to back up, restore and monitor, and enqueue is transactional with the business write —
 * the same property the outbox has, for the same reason.
 *
 * docs/adr/0008-background-jobs.md
 */

export const jobQueue = pgTable(
  'job_queue',
  {
    id: uuid('id').primaryKey(),
    jobType: text('job_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status').notNull().default('PENDING'),
    /** Lower runs first. */
    priority: integer('priority').notNull().default(100),
    runAfter: instant('run_after')
      .notNull()
      .default(sql`now()`),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    claimedBy: text('claimed_by'),
    claimedAt: instant('claimed_at'),
    lastError: text('last_error'),
    /**
     * Enqueue-once semantics. A handler that re-enqueues on retry cannot create a
     * duplicate — which matters because at-least-once delivery means retries happen.
     */
    idempotencyKey: text('idempotency_key'),
    correlationId: uuid('correlation_id'),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`now()`),
    completedAt: instant('completed_at'),
  },
  (t) => [
    // Partial index: the claimable set stays small forever while the table grows without
    // bound, so the poll query stays cheap.
    index('idx_job_queue__claimable')
      .on(t.priority, t.runAfter)
      .where(sql`${t.status} = 'PENDING'`),
    index('idx_job_queue__type_status').on(t.jobType, t.status),
    index('idx_job_queue__dead')
      .on(t.createdAt.desc())
      .where(sql`${t.status} = 'DEAD'`),
    uniqueIndex('uq_job_queue__idempotency')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    check(
      'ck_job_queue__status',
      sql`${t.status} in ('PENDING','CLAIMED','DONE','FAILED','DEAD')`,
    ),
    check(
      'ck_job_queue__attempts',
      sql`${t.attempts} >= 0 and ${t.attempts} <= ${t.maxAttempts}`,
    ),
  ],
)

/**
 * Runtime business settings (M23).
 *
 * The M23 key control: "Every configuration change is logged with the user, the old value
 * and the new value." The history table is append-only.
 *
 * These are BUSINESS RULES — mass-balance tolerance, safe-fill %, free storage days,
 * approval thresholds — changeable by an authorised administrator without a deployment.
 * Infrastructure wiring lives in environment variables and is NOT here.
 */
export const systemSetting = pgTable(
  'system_setting',
  {
    id: uuid('id').primaryKey(),
    /** Namespaced: `processing.mass_balance_tolerance_pct`. */
    key: text('key').notNull(),
    /** JSON so a setting can be a number, string, boolean or structured value. */
    value: jsonb('value').notNull(),
    valueType: text('value_type').notNull(),
    description: text('description').notNull(),
    unit: text('unit'),
    /** Permission required to change it. */
    editableByPermission: text('editable_by_permission')
      .notNull()
      .default('admin:manage_settings'),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`now()`),
    createdBy: uuid('created_by').notNull(),
    updatedAt: instant('updated_at')
      .notNull()
      .default(sql`now()`),
    updatedBy: uuid('updated_by'),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    uniqueIndex('uq_system_setting__key').on(t.key),
    check(
      'ck_system_setting__value_type',
      sql`${t.valueType} in ('number','string','boolean','json','duration','percentage')`,
    ),
  ],
)

/** Append-only: old value, new value, who, when. The M23 key control. */
export const systemSettingHistory = pgTable(
  'system_setting_history',
  {
    id: uuid('id').primaryKey(),
    settingKey: text('setting_key').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value').notNull(),
    reason: text('reason'),
    changedBy: uuid('changed_by').notNull(),
    changedAt: instant('changed_at')
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index('idx_system_setting_history__key').on(t.settingKey, t.changedAt.desc())],
)
