import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { uuidv7 } from '@core/ids/id-generator'
import type { WorkflowStepDefinition } from '../domain/routing'
import {
  insertWorkflowDefinition,
  listWorkflowDefinitions,
  type WorkflowDefinitionRow,
} from '../infrastructure/workflow.repository'

export type { WorkflowDefinitionRow }

export interface CreateWorkflowDefinitionInput {
  readonly code: string
  readonly name: string
  readonly entityType: string
  readonly steps: readonly WorkflowStepDefinition[]
  readonly actorId: string
}

export async function createWorkflowDefinition(
  claims: DbClaims,
  input: CreateWorkflowDefinitionInput,
): Promise<void> {
  await runInTransaction(claims, (tx) =>
    insertWorkflowDefinition(tx, {
      id: uuidv7(),
      code: input.code,
      name: input.name,
      entityType: input.entityType,
      steps: input.steps,
      actorId: input.actorId,
    }),
  )
}

export async function listWorkflowDefinitionsForAdmin(
  claims: DbClaims,
): Promise<WorkflowDefinitionRow[]> {
  return runInTransaction(claims, (tx) => listWorkflowDefinitions(tx))
}
