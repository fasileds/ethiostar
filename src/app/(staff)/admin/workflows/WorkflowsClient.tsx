'use client'

import { useActionState } from 'react'
import { Input, Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { WorkflowDefinitionRow } from '@modules/workflow'
import { createWorkflowDefinitionAction } from './actions'

const STEPS_PLACEHOLDER = JSON.stringify(
  [
    { stepNo: 1, name: 'Branch review', approverRole: 'BRANCH_MANAGER' },
    {
      stepNo: 2,
      name: 'Operations approval',
      approverRole: 'OPERATIONS_MANAGER',
      minThresholdKg: 5000,
    },
  ],
  null,
  2,
)

export function WorkflowsClient({
  definitions,
}: {
  readonly definitions: readonly WorkflowDefinitionRow[]
}) {
  return (
    <div className="space-y-6">
      <NewDefinitionForm />
      <DefinitionTable definitions={definitions} />
    </div>
  )
}

function NewDefinitionForm() {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) =>
      (await createWorkflowDefinitionAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4"
    >
      <p className="text-sm font-medium">Add a workflow definition</p>
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          label="Code"
          name="code"
          placeholder="DELIVERY_REQUEST_APPROVAL"
          hint="Upper case, digits and underscores only."
          error={errors.code}
          required
        />
        <Input label="Name" name="name" error={errors.name} required />
        <Input
          label="Entity type"
          name="entityType"
          placeholder="delivery_request"
          error={errors.entityType}
          required
        />
      </div>

      <Textarea
        label="Steps (JSON)"
        name="steps"
        rows={8}
        defaultValue={STEPS_PLACEHOLDER}
        hint="Ordered array. A step with neither threshold set always applies."
        error={errors.steps}
        required
        className="font-mono"
      />

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add definition'}
      </Button>
    </form>
  )
}

function DefinitionTable({
  definitions,
}: {
  readonly definitions: readonly WorkflowDefinitionRow[]
}) {
  if (definitions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">
        No workflow definitions yet. Add the first one above.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] ring-1 ring-[var(--border-subtle)]">
      {definitions.map((definition) => (
        <li key={definition.id} className="space-y-1 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-[var(--text-tertiary)]">
              {definition.code}
            </span>
            <span className="font-medium">{definition.name}</span>
            <span className="text-2xs text-[var(--text-tertiary)]">v{definition.version}</span>
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              {definition.entityType}
            </span>
            {!definition.isActive ? (
              <span className="rounded bg-warning-50 px-1.5 py-0.5 text-2xs font-semibold text-warning-900 dark:bg-warning-900/25 dark:text-warning-100">
                Inactive
              </span>
            ) : null}
          </div>
          <p className="font-mono text-xs text-[var(--text-tertiary)]">
            {definition.steps.map((step) => step.name).join(' → ')}
          </p>
        </li>
      ))}
    </ul>
  )
}
