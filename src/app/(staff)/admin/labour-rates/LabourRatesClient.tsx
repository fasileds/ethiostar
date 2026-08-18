'use client'

import { useActionState } from 'react'
import { Input, Select } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { LabourRateRow, LabourActivityTypeOption, BranchOption } from '@modules/labour'
import { createLabourRateAction } from './actions'

const RATE_BASIS_OPTIONS = [
  { value: 'PER_KESHA', label: 'Per kesha' },
  { value: 'PER_KG', label: 'Per kilogram' },
  { value: 'PER_DAY', label: 'Per day' },
  { value: 'PER_HOUR', label: 'Per hour' },
]

export function LabourRatesClient({
  rates,
  activityTypes,
  branches,
}: {
  readonly rates: readonly LabourRateRow[]
  readonly activityTypes: readonly LabourActivityTypeOption[]
  readonly branches: readonly BranchOption[]
}) {
  return (
    <div className="space-y-6">
      <NewLabourRateForm activityTypes={activityTypes} branches={branches} />
      <LabourRateTable rates={rates} />
    </div>
  )
}

function NewLabourRateForm({
  activityTypes,
  branches,
}: {
  readonly activityTypes: readonly LabourActivityTypeOption[]
  readonly branches: readonly BranchOption[]
}) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await createLabourRateAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4"
    >
      <p className="text-sm font-medium">Add a rate</p>
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Branch"
          name="branchId"
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          placeholder="Choose a branch"
          error={errors.branchId}
          required
        />
        <Select
          label="Activity"
          name="activityTypeId"
          options={activityTypes.map((a) => ({ value: a.id, label: a.name }))}
          placeholder="Choose an activity"
          error={errors.activityTypeId}
          required
        />
        <Select
          label="Rate basis"
          name="rateBasis"
          options={RATE_BASIS_OPTIONS}
          placeholder="Choose a basis"
          error={errors.rateBasis}
          required
        />
        <Input
          label="Rate amount"
          name="rateAmount"
          placeholder="12.50"
          hint="Up to two decimal places."
          error={errors.rateAmount}
          required
        />
        <Input
          label="Currency"
          name="currency"
          defaultValue="ETB"
          maxLength={3}
          error={errors.currency}
          required
        />
        <Input
          label="Effective from"
          name="effectiveFrom"
          type="date"
          error={errors.effectiveFrom}
          required
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add rate'}
      </Button>
    </form>
  )
}

function LabourRateTable({ rates }: { readonly rates: readonly LabourRateRow[] }) {
  if (rates.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">
        No labour rates yet. Add the first one above.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] ring-1 ring-[var(--border-subtle)]">
      {rates.map((rate) => (
        <LabourRateRowItem key={rate.id} rate={rate} />
      ))}
    </ul>
  )
}

function LabourRateRowItem({ rate }: { readonly rate: LabourRateRow }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{rate.activityName}</span>
          <span className="text-2xs text-[var(--text-tertiary)]">{rate.branchName}</span>
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {rate.rateBasis}
          </span>
          {rate.effectiveTo === null ? (
            <span className="rounded bg-success-50 px-1.5 py-0.5 text-2xs font-semibold text-success-900 dark:bg-success-900/25 dark:text-success-100">
              Current
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
          {rate.currency} {rate.rateAmount} · {rate.effectiveFrom}
          {' – '}
          {rate.effectiveTo ?? 'open'}
        </p>
      </div>
    </li>
  )
}
