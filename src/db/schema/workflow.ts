import {
  pgTable,
  text,
  uuid,
  integer,
  index,
  uniqueIndex,
  check,
  jsonb,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { activeFlag, instant } from '../helpers/columns'

/**
 * M03 — Workflow & Approval Engine.
 *
 * "A single configurable engine for every approval in the system, so that when EthioStar
 * changes who approves what, the change is made in configuration rather than in code."
 *
 * Phase 1 hardcoded the two approval flows it needed behind an `ApprovalPolicy` port
 * (docs/phase-1/scope.md B2), with approval decisions carrying a nullable
 * `workflow_instance_id` for exactly this day. This is that table set: a versioned
 * DEFINITION (the steps and who approves each one), an INSTANCE per entity that started
 * flowing through one, and a TASK per step — which is what the unified inbox reads from.
 */

/**
 * A step is `{ stepNo, name, approverRole, minThresholdKg?: string, maxThresholdKg?: string }`.
 * Conditional routing ("a delivery request above a configured tonnage requires the
 * Operations Manager") is expressed as a threshold on the step rather than a general
 * expression language — the client's own example is a numeric range, and a real expression
 * evaluator is a security surface this system does not need yet.
 */
export const workflowDefinition = pgTable(
  'workflow_definition',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** What kind of entity this definition routes — `delivery_request`, `customer_application`. */
    entityType: text('entity_type').notNull(),
    /** Bumped on every edit. In-flight instances keep the version they started under. */
    version: integer('version').notNull().default(1),
    steps: jsonb('steps').notNull(),
    isActive: activeFlag(),
    // Not `...auditColumns()` — its optimistic-concurrency column is also named `version`,
    // which collides with the definition's own revision number above. Same four columns,
    // concurrency one named `versionNo` (matches migration 0031's `version_no`).
    createdAt: instant('created_at')
      .notNull()
      .default(sql`now()`),
    createdBy: uuid('created_by').notNull(),
    updatedAt: instant('updated_at')
      .notNull()
      .default(sql`now()`),
    updatedBy: uuid('updated_by'),
    versionNo: integer('version_no').notNull().default(0),
  },
  (t) => [
    uniqueIndex('uq_workflow_definition__code_version').on(t.code, t.version),
    index('idx_workflow_definition__entity_type').on(t.entityType, t.isActive),
  ],
)

/** One entity's journey through one definition's steps. */
export const workflowInstance = pgTable(
  'workflow_instance',
  {
    id: uuid('id').primaryKey(),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => workflowDefinition.id),
    definitionVersion: integer('definition_version').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    /** PENDING → APPROVED | REJECTED | CANCELLED */
    status: text('status').notNull().default('PENDING'),
    currentStepNo: integer('current_step_no').notNull().default(1),
    startedBy: uuid('started_by').notNull(),
    startedAt: instant('started_at')
      .notNull()
      .default(sql`now()`),
    completedAt: instant('completed_at'),
  },
  (t) => [
    index('idx_workflow_instance__entity').on(t.entityType, t.entityId),
    index('idx_workflow_instance__pending')
      .on(t.currentStepNo)
      .where(sql`${t.status} = 'PENDING'`),
    check(
      'ck_workflow_instance__status',
      sql`${t.status} in ('PENDING','APPROVED','REJECTED','CANCELLED')`,
    ),
  ],
)

/**
 * One task per step. The unified inbox (M03 §5) is `select * from workflow_task where
 * status = 'PENDING' and (assigned_user_id = :me or assigned_role = any(:my_roles))`.
 */
export const workflowTask = pgTable(
  'workflow_task',
  {
    id: uuid('id').primaryKey(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => workflowInstance.id, { onDelete: 'cascade' }),
    stepNo: integer('step_no').notNull(),
    /** Whoever holds this role may act — OR a specific user when delegated. */
    assignedRole: text('assigned_role'),
    assignedUserId: uuid('assigned_user_id'),
    /** PENDING → APPROVED | REJECTED | RETURNED */
    status: text('status').notNull().default('PENDING'),
    /** Mandatory on reject/return (M03 key control), free-text on approve. */
    comment: text('comment'),
    decidedBy: uuid('decided_by'),
    decidedAt: instant('decided_at'),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('idx_workflow_task__instance').on(t.instanceId, t.stepNo),
    index('idx_workflow_task__inbox_role').on(t.assignedRole, t.status),
    index('idx_workflow_task__inbox_user').on(t.assignedUserId, t.status),
    check(
      'ck_workflow_task__status',
      sql`${t.status} in ('PENDING','APPROVED','REJECTED','RETURNED')`,
    ),
    check(
      'ck_workflow_task__assignee',
      sql`${t.assignedRole} is not null or ${t.assignedUserId} is not null`,
    ),
    check(
      'ck_workflow_task__decision_comment',
      sql`${t.status} not in ('REJECTED','RETURNED') or ${t.comment} is not null`,
    ),
  ],
)
