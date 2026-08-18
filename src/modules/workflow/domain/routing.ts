/**
 * M03 — step routing.
 *
 * A `WorkflowDefinition.steps` array describes every possible step; which ones actually
 * apply to a given entity depends on its context value (a delivery request's declared
 * quantity in kg, a contract's credit limit). A step with neither threshold set always
 * applies; a step with one or both set applies only when the context value falls inside
 * that range — the client's own example, "a delivery request above a configured tonnage
 * requires the Operations Manager", expressed as data rather than an expression language.
 */

export interface WorkflowStepDefinition {
  readonly stepNo: number
  readonly name: string
  readonly approverRole: string
  readonly minThresholdKg?: number
  readonly maxThresholdKg?: number
}

function stepApplies(step: WorkflowStepDefinition, contextValue: number): boolean {
  if (step.minThresholdKg === undefined && step.maxThresholdKg === undefined) return true
  if (step.minThresholdKg !== undefined && contextValue < step.minThresholdKg) return false
  if (step.maxThresholdKg !== undefined && contextValue > step.maxThresholdKg) return false
  return true
}

/** The ordered route this entity actually travels, given its context value. */
export function resolveApplicableSteps(
  steps: readonly WorkflowStepDefinition[],
  contextValue: number,
): WorkflowStepDefinition[] {
  return steps
    .filter((step) => stepApplies(step, contextValue))
    .slice()
    .sort((a, b) => a.stepNo - b.stepNo)
}
