import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import type { WorkflowStepDefinition } from '../domain/routing'

/**
 * M03 raw-SQL repository — `workflow_definition`, `workflow_instance`, `workflow_task`.
 */

export interface WorkflowDefinitionRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly entityType: string
  readonly version: number
  readonly steps: readonly WorkflowStepDefinition[]
  readonly isActive: boolean
}

function toDefinitionRow(row: Record<string, unknown>): WorkflowDefinitionRow {
  return {
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name),
    entityType: col.text(row.entity_type),
    version: col.int(row.version),
    steps: row.steps as WorkflowStepDefinition[],
    isActive: col.bool(row.is_active),
  }
}

export interface InsertWorkflowDefinitionInput {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly entityType: string
  readonly steps: readonly WorkflowStepDefinition[]
  readonly actorId: string
}

/** Inserts the next `version` for `code` — an edit is a new row, never an in-place update. */
export async function insertWorkflowDefinition(
  tx: Tx,
  input: InsertWorkflowDefinitionInput,
): Promise<void> {
  await tx.execute(sql`
    insert into public.workflow_definition (
      id, code, name, entity_type, version, steps, is_active, created_by, created_at, updated_at
    )
    select
      ${input.id}, ${input.code}, ${input.name}, ${input.entityType},
      coalesce((select max(version) + 1 from public.workflow_definition where code = ${input.code}), 1),
      ${JSON.stringify(input.steps)}::jsonb, true, ${input.actorId}::uuid, now(), now()
  `)
}

export async function listWorkflowDefinitions(tx: Tx): Promise<WorkflowDefinitionRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, name, entity_type, version, steps, is_active
      from public.workflow_definition
      order by code, version desc
    `,
  )
  return rows.map(toDefinitionRow)
}

export async function findActiveDefinitionForEntityType(
  tx: Tx,
  entityType: string,
): Promise<WorkflowDefinitionRow | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, name, entity_type, version, steps, is_active
      from public.workflow_definition
      where entity_type = ${entityType} and is_active = true
      order by version desc
      limit 1
    `,
  )
  return rows[0] ? toDefinitionRow(rows[0]) : undefined
}

export interface WorkflowInstanceRow {
  readonly id: string
  readonly definitionId: string
  readonly definitionVersion: number
  readonly entityType: string
  readonly entityId: string
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  readonly currentStepNo: number
  readonly startedBy: string
  readonly startedAt: Date
  readonly completedAt: Date | null
}

function toInstanceRow(row: Record<string, unknown>): WorkflowInstanceRow {
  return {
    id: col.text(row.id),
    definitionId: col.text(row.definition_id),
    definitionVersion: col.int(row.definition_version),
    entityType: col.text(row.entity_type),
    entityId: col.text(row.entity_id),
    status: col.text(row.status) as WorkflowInstanceRow['status'],
    currentStepNo: col.int(row.current_step_no),
    startedBy: col.text(row.started_by),
    startedAt: col.date(row.started_at),
    completedAt: col.dateOrNull(row.completed_at),
  }
}

export interface InsertWorkflowInstanceInput {
  readonly id: string
  readonly definitionId: string
  readonly definitionVersion: number
  readonly entityType: string
  readonly entityId: string
  readonly currentStepNo: number
  readonly startedBy: string
}

export async function insertWorkflowInstance(
  tx: Tx,
  input: InsertWorkflowInstanceInput,
): Promise<void> {
  await tx.execute(sql`
    insert into public.workflow_instance (
      id, definition_id, definition_version, entity_type, entity_id, status,
      current_step_no, started_by, started_at
    ) values (
      ${input.id}::uuid, ${input.definitionId}::uuid, ${input.definitionVersion},
      ${input.entityType}, ${input.entityId}::uuid, 'PENDING',
      ${input.currentStepNo}, ${input.startedBy}::uuid, now()
    )
  `)
}

export async function findInstance(
  tx: Tx,
  id: string,
): Promise<WorkflowInstanceRow | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select id, definition_id, definition_version, entity_type, entity_id, status,
             current_step_no, started_by, started_at, completed_at
      from public.workflow_instance
      where id = ${id}::uuid
    `,
  )
  return rows[0] ? toInstanceRow(rows[0]) : undefined
}

export interface UpdateInstanceStatusInput {
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  readonly currentStepNo?: number
  readonly completed?: boolean
}

export async function updateInstanceStatus(
  tx: Tx,
  id: string,
  input: UpdateInstanceStatusInput,
): Promise<void> {
  await tx.execute(sql`
    update public.workflow_instance
    set status = ${input.status},
        current_step_no = coalesce(${input.currentStepNo ?? null}, current_step_no),
        completed_at = case when ${input.completed ?? false} then now() else completed_at end
    where id = ${id}::uuid
  `)
}

export interface WorkflowTaskRow {
  readonly id: string
  readonly instanceId: string
  readonly stepNo: number
  readonly assignedRole: string | null
  readonly assignedUserId: string | null
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED'
  readonly comment: string | null
  readonly decidedBy: string | null
  readonly decidedAt: Date | null
  readonly createdAt: Date
}

function toTaskRow(row: Record<string, unknown>): WorkflowTaskRow {
  return {
    id: col.text(row.id),
    instanceId: col.text(row.instance_id),
    stepNo: col.int(row.step_no),
    assignedRole: col.textOrNull(row.assigned_role),
    assignedUserId: col.textOrNull(row.assigned_user_id),
    status: col.text(row.status) as WorkflowTaskRow['status'],
    comment: col.textOrNull(row.comment),
    decidedBy: col.textOrNull(row.decided_by),
    decidedAt: col.dateOrNull(row.decided_at),
    createdAt: col.date(row.created_at),
  }
}

export interface InsertWorkflowTaskInput {
  readonly id: string
  readonly instanceId: string
  readonly stepNo: number
  readonly assignedRole?: string | null
  readonly assignedUserId?: string | null
}

export async function insertWorkflowTask(
  tx: Tx,
  input: InsertWorkflowTaskInput,
): Promise<void> {
  await tx.execute(sql`
    insert into public.workflow_task (
      id, instance_id, step_no, assigned_role, assigned_user_id, status, created_at
    ) values (
      ${input.id}::uuid, ${input.instanceId}::uuid, ${input.stepNo},
      ${input.assignedRole ?? null}, ${input.assignedUserId ?? null}::uuid, 'PENDING', now()
    )
  `)
}

export async function findTaskById(tx: Tx, id: string): Promise<WorkflowTaskRow | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select id, instance_id, step_no, assigned_role, assigned_user_id, status, comment,
             decided_by, decided_at, created_at
      from public.workflow_task
      where id = ${id}::uuid
    `,
  )
  return rows[0] ? toTaskRow(rows[0]) : undefined
}

export async function listTasksForInstance(
  tx: Tx,
  instanceId: string,
): Promise<WorkflowTaskRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, instance_id, step_no, assigned_role, assigned_user_id, status, comment,
             decided_by, decided_at, created_at
      from public.workflow_task
      where instance_id = ${instanceId}::uuid
      order by step_no
    `,
  )
  return rows.map(toTaskRow)
}

export interface UpdateTaskDecisionInput {
  readonly status: 'APPROVED' | 'REJECTED' | 'RETURNED'
  readonly comment: string | null
  readonly decidedBy: string
}

export async function updateTaskDecision(
  tx: Tx,
  id: string,
  input: UpdateTaskDecisionInput,
): Promise<void> {
  await tx.execute(sql`
    update public.workflow_task
    set status = ${input.status}, comment = ${input.comment}, decided_by = ${input.decidedBy}::uuid,
        decided_at = now()
    where id = ${id}::uuid
  `)
}

export interface InboxTaskRow {
  readonly id: string
  readonly instanceId: string
  readonly stepNo: number
  readonly assignedRole: string | null
  readonly createdAt: Date
  readonly entityType: string
  readonly entityId: string
  readonly definitionName: string
}

/**
 * A task is in `userId`'s inbox when it is PENDING, its instance's current step matches it
 * (future steps already exist as rows — see decision.ts — but are not yet actionable), and
 * either it was delegated to this user directly or their roles include the assigned role.
 */
export async function listInboxTasks(
  tx: Tx,
  { roles, userId }: { readonly roles: readonly string[]; readonly userId: string },
): Promise<InboxTaskRow[]> {
  const roleList = roles.length > 0 ? roles : ['__none__']

  const rows = await rawRows(
    tx,
    sql`
      select wt.id, wt.instance_id, wt.step_no, wt.assigned_role, wt.created_at,
             wi.entity_type, wi.entity_id, wd.name as definition_name
      from public.workflow_task wt
      join public.workflow_instance wi on wi.id = wt.instance_id
      join public.workflow_definition wd on wd.id = wi.definition_id
      where wt.status = 'PENDING'
        and wt.step_no = wi.current_step_no
        and (wt.assigned_user_id = ${userId}::uuid or wt.assigned_role = any(${roleList}))
      order by wt.created_at
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    instanceId: col.text(row.instance_id),
    stepNo: col.int(row.step_no),
    assignedRole: col.textOrNull(row.assigned_role),
    createdAt: col.date(row.created_at),
    entityType: col.text(row.entity_type),
    entityId: col.text(row.entity_id),
    definitionName: col.text(row.definition_name),
  }))
}
