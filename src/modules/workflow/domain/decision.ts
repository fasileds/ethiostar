/**
 * M03 — decision outcomes.
 *
 * The full route an instance travels is resolved once, at `startWorkflow` time, from the
 * entity's context value (see `routing.ts`) — every applicable step's task row is created
 * up front, but only the task for `currentStepNo` is visible in anyone's inbox
 * (`listInboxTasks` filters on it). That is what lets a decision be computed from the
 * instance and its tasks alone, with no need to re-evaluate thresholds against a context
 * value the workflow module never sees again.
 */

export type TaskDecision = 'APPROVE' | 'REJECT' | 'RETURN'

export interface DecisionOutcome {
  readonly instanceStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  /** Set only when the instance stays PENDING. */
  readonly nextStepNo: number | null
}

/**
 * `remainingStepNos` is every step number this instance still holds a task for beyond the
 * one just decided, ascending. A reject or return short-circuits the whole instance to
 * REJECTED — resubmission after a return is out of scope for this pass (M03 §7).
 */
export function resolveDecisionOutcome(
  decision: TaskDecision,
  remainingStepNos: readonly number[],
): DecisionOutcome {
  if (decision === 'REJECT' || decision === 'RETURN') {
    return { instanceStatus: 'REJECTED', nextStepNo: null }
  }

  const next = remainingStepNos[0]
  if (next === undefined) return { instanceStatus: 'APPROVED', nextStepNo: null }
  return { instanceStatus: 'PENDING', nextStepNo: next }
}
