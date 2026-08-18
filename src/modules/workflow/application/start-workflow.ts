import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { uuidv7 } from '@core/ids/id-generator'
import { resolveApplicableSteps } from '../domain/routing'
import {
  findActiveDefinitionForEntityType,
  insertWorkflowInstance,
  insertWorkflowTask,
} from '../infrastructure/workflow.repository'

export interface StartWorkflowInput {
  readonly entityType: string
  readonly entityId: string
  /** The numeric value threshold routing checks — kg, credit limit, whatever the definition's steps threshold on. */
  readonly contextValue: number
  readonly startedBy: string
}

export interface StartedWorkflow {
  readonly instanceId: string
}

/**
 * Finds the active definition for `entityType`, resolves the ordered route this entity
 * actually travels (`resolveApplicableSteps`), and creates the instance plus a task for
 * every step on that route — see `domain/decision.ts` for why the whole route is created
 * up front rather than one task at a time.
 *
 * Returns `null` when no active definition exists for `entityType`, or when the resolved
 * route is empty (no step's threshold matches this context value) — either is "this entity
 * does not need approval right now", not an error.
 */
export async function startWorkflow(
  claims: DbClaims,
  input: StartWorkflowInput,
): Promise<StartedWorkflow | null> {
  return runInTransaction(claims, async (tx) => {
    const definition = await findActiveDefinitionForEntityType(tx, input.entityType)
    if (!definition) return null

    const route = resolveApplicableSteps(definition.steps, input.contextValue)
    const first = route[0]
    if (!first) return null

    const instanceId = uuidv7()
    await insertWorkflowInstance(tx, {
      id: instanceId,
      definitionId: definition.id,
      definitionVersion: definition.version,
      entityType: input.entityType,
      entityId: input.entityId,
      currentStepNo: first.stepNo,
      startedBy: input.startedBy,
    })

    for (const step of route) {
      await insertWorkflowTask(tx, {
        id: uuidv7(),
        instanceId,
        stepNo: step.stepNo,
        assignedRole: step.approverRole,
      })
    }

    return { instanceId }
  })
}
