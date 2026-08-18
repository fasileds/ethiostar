/**
 * M03 — Workflow & Approval Engine.
 *
 * "A single configurable engine for every approval in the system, so that when EthioStar
 * changes who approves what, the change is made in configuration rather than in code."
 *
 * `startWorkflow` is the integration point for any tier-3+ module: contracts (M10) calls
 * `startWorkflow(claims, { entityType: 'contract', entityId: contract.id,
 * contextValue: creditLimitAmount, startedBy: actorId })` when a contract is activated, and
 * gets a workflow instance back if — and only if — an active `workflow_definition` exists
 * for `entityType = 'contract'`. Nothing else needs wiring on this module's side.
 */

export { resolveApplicableSteps, type WorkflowStepDefinition } from './domain/routing'

export {
  resolveDecisionOutcome,
  type TaskDecision,
  type DecisionOutcome,
} from './domain/decision'

export {
  listWorkflowDefinitions,
  findActiveDefinitionForEntityType,
  findInstance,
  listTasksForInstance,
  listInboxTasks,
  type WorkflowDefinitionRow,
  type WorkflowInstanceRow,
  type WorkflowTaskRow,
  type InboxTaskRow,
} from './infrastructure/workflow.repository'

export {
  startWorkflow,
  type StartWorkflowInput,
  type StartedWorkflow,
} from './application/start-workflow'

export { decideTask, type DecideTaskInput } from './application/decide-task'

export { myInboxTasks } from './application/inbox.query'

export {
  createWorkflowDefinition,
  listWorkflowDefinitionsForAdmin,
  type CreateWorkflowDefinitionInput,
} from './application/definition-admin'
