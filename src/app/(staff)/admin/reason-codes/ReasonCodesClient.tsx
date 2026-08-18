'use client'

import { useActionState, useState } from 'react'
import { Input, Select, Textarea, Checkbox } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { ReasonCodeAdminRow, ReasonCodeCategoryRow } from '@modules/master-data'
import { createReasonCodeAction, setReasonCodeActiveAction } from './actions'

export function ReasonCodesClient({
  categories,
  codes,
}: {
  readonly categories: readonly ReasonCodeCategoryRow[]
  readonly codes: readonly ReasonCodeAdminRow[]
}) {
  return (
    <div className="space-y-6">
      <NewReasonCodeForm categories={categories} />
      <ReasonCodeTable codes={codes} />
    </div>
  )
}

function NewReasonCodeForm({
  categories,
}: {
  readonly categories: readonly ReasonCodeCategoryRow[]
}) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await createReasonCodeAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4"
    >
      <p className="text-sm font-medium">Add a reason code</p>
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Category"
          name="categoryId"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Choose a category"
          error={errors.categoryId}
          required
        />
        <Input
          label="Code"
          name="code"
          placeholder="MOISTURE_HIGH"
          hint="Upper case, digits and underscores only."
          error={errors.code}
          required
        />
        <Input label="Name" name="nameEn" error={errors.nameEn} required />
        <Textarea
          label="Description (optional)"
          name="description"
          rows={1}
          error={errors.description}
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <Checkbox label="Requires a typed explanation" name="requiresNarrative" value="true" />
        <Checkbox label="Flags on the exception register" name="isException" value="true" />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add reason code'}
      </Button>
    </form>
  )
}

function ReasonCodeTable({ codes }: { readonly codes: readonly ReasonCodeAdminRow[] }) {
  if (codes.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">
        No reason codes yet. Add the first one above.
      </p>
    )
  }

  const byCategory = new Map<string, ReasonCodeAdminRow[]>()
  for (const code of codes) {
    const group = byCategory.get(code.categoryName) ?? []
    group.push(code)
    byCategory.set(code.categoryName, group)
  }

  return (
    <div className="space-y-6">
      {[...byCategory.entries()].map(([categoryName, group]) => (
        <div key={categoryName}>
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-secondary)]">
            {categoryName}
          </h3>
          <ul className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] ring-1 ring-[var(--border-subtle)]">
            {group.map((code) => (
              <ReasonCodeRow key={code.id} code={code} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function ReasonCodeRow({ code }: { readonly code: ReasonCodeAdminRow }) {
  const [pending, setPending] = useState(false)

  async function toggle() {
    setPending(true)
    const formData = new FormData()
    formData.set('id', code.id)
    formData.set('isActive', String(!code.isActive))
    await setReasonCodeActiveAction(formData)
    setPending(false)
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--text-tertiary)]">{code.code}</span>
          <span className="font-medium">{code.name}</span>
          {!code.isActive ? (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              Inactive
            </span>
          ) : null}
          {code.isException ? (
            <span className="rounded bg-warning-50 px-1.5 py-0.5 text-2xs font-semibold text-warning-900 dark:bg-warning-900/25 dark:text-warning-100">
              Exception
            </span>
          ) : null}
          {code.requiresNarrative ? (
            <span className="text-2xs text-[var(--text-tertiary)]">requires explanation</span>
          ) : null}
        </div>
        {code.description ? (
          <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">{code.description}</p>
        ) : null}
      </div>
      <Button size="sm" variant="secondary" onClick={toggle} disabled={pending}>
        {code.isActive ? 'Deactivate' : 'Activate'}
      </Button>
    </li>
  )
}
