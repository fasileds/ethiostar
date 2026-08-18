import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { NotFoundError, ConflictError } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { resolveDecisionOutcome, type TaskDecision } from '../domain/decision'
import {
  findTaskById,
  findInstance,
  listTasksForInstance,
  updateTaskDecision,
  updateInstanceStatus,
} from '../infrastructure/workflow.repository'

export interface DecideTaskInput {
  readonly taskId: string
  readonly decision: TaskDecision
  readonly comment: string | null
  readonly actorId: string
}

/**
 * Records a decision on a task, then either advances the instance to the next step already
 * on its route or completes it. REJECT and RETURN both short-circuit the whole instance to
 * REJECTED — a returned item needs the requester to resubmit, out of scope for this pass
 * (M03 §7); the comment explains what to fix.
 */
export async function decideTask(claims: DbClaims, input: DecideTaskInput): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const task = await findTaskById(tx, input.taskId)
    if (!task) throw NotFoundError.of('Task', input.taskId)
    if (task.status !== 'PENDING') {
      throw new ConflictError(ERROR_CODES.CONFLICT, {
        message: 'This task has already been decided.',
      })
    }

    const instance = await findInstance(tx, task.instanceId)
    if (!instance) throw NotFoundError.of('Workflow instance', task.instanceId)

    const taskStatus =
      input.decision === 'APPROVE'
        ? 'APPROVED'
        : input.decision === 'REJECT'
          ? 'REJECTED'
          : 'RETURNED'

    await updateTaskDecision(tx, task.id, {
      status: taskStatus,
      comment: input.comment,
      decidedBy: input.actorId,
    })

    const tasks = await listTasksForInstance(tx, instance.id)
    const remainingStepNos = tasks
      .filter((t) => t.stepNo > task.stepNo)
      .map((t) => t.stepNo)
      .sort((a, b) => a - b)

    const outcome = resolveDecisionOutcome(input.decision, remainingStepNos)

    if (outcome.instanceStatus === 'PENDING' && outcome.nextStepNo !== null) {
      await updateInstanceStatus(tx, instance.id, {
        status: 'PENDING',
        currentStepNo: outcome.nextStepNo,
      })
    } else {
      await updateInstanceStatus(tx, instance.id, {
        status: outcome.instanceStatus,
        completed: true,
      })
    }
  })
}
