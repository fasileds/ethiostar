'use client'

import { useActionState, useState } from 'react'
import { Input, Select } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { StorageRateTierRow } from '@modules/billing'
import {
  addStorageRateTierAction,
  setStorageRateTierActiveAction,
  runStorageChargingAction,
} from './actions'

interface BranchOption {
  readonly id: string
  readonly name: string
}

export function StorageRatesClient({
  tiers,
  branches,
}: {
  readonly tiers: readonly StorageRateTierRow[]
  readonly branches: readonly BranchOption[]
}) {
  return (
    <div className="space-y-6">
      <RunChargingButton />
      <NewTierForm branches={branches} />
      <TierTable tiers={tiers} />
    </div>
  )
}

function RunChargingButton() {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setPending(true)
    setError(null)
    setMessage(null)
    const result = await runStorageChargingAction(new FormData())
    setPending(false)
    if (result.ok) {
      setMessage(`${result.data?.chargesCreated ?? 0} storage charge(s) created.`)
    } else {
      setError(result.error.message)
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={run} disabled={pending}>
        {pending ? 'Running…' : 'Run storage charging'}
      </Button>
      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  )
}

function NewTierForm({ branches }: { readonly branches: readonly BranchOption[] }) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await addStorageRateTierAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4"
    >
      <p className="text-sm font-medium">Add a rate tier</p>
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select
          label="Branch"
          name="branchId"
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          placeholder="Choose a branch"
          error={errors.branchId}
          required
        />
        <Input
          label="From day"
          name="fromDay"
          type="number"
          min={0}
          hint="Dwell day this tier starts applying from."
          error={errors.fromDay}
          required
        />
        <Input
          label="Rate (per kg per day)"
          name="ratePerKgPerDay"
          error={errors.ratePerKgPerDay}
          required
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add tier'}
      </Button>
    </form>
  )
}

function TierTable({ tiers }: { readonly tiers: readonly StorageRateTierRow[] }) {
  if (tiers.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">
        No storage rate tiers yet.
      </p>
    )
  }

  const byBranch = new Map<string, StorageRateTierRow[]>()
  for (const tier of tiers) {
    const group = byBranch.get(tier.branchName) ?? []
    group.push(tier)
    byBranch.set(tier.branchName, group)
  }

  return (
    <div className="space-y-6">
      {[...byBranch.entries()].map(([branchName, group]) => (
        <div key={branchName}>
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-secondary)]">
            {branchName}
          </h3>
          <ul className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] ring-1 ring-[var(--border-subtle)]">
            {group.map((tier) => (
              <TierRow key={tier.id} tier={tier} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function TierRow({ tier }: { readonly tier: StorageRateTierRow }) {
  const [pending, setPending] = useState(false)

  async function toggle() {
    setPending(true)
    const formData = new FormData()
    formData.set('id', tier.id)
    formData.set('isActive', String(!tier.isActive))
    await setStorageRateTierActiveAction(formData)
    setPending(false)
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="numeric shrink-0 text-sm font-medium">from day {tier.fromDay}</span>
      <span className="numeric flex-1 text-sm">
        {tier.ratePerKgPerDay} {tier.currency}/kg/day
      </span>
      {!tier.isActive ? (
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          Inactive
        </span>
      ) : null}
      <Button size="sm" variant="secondary" onClick={toggle} disabled={pending}>
        {tier.isActive ? 'Deactivate' : 'Activate'}
      </Button>
    </li>
  )
}
