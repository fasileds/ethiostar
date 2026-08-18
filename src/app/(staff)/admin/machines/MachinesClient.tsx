'use client'

import { useActionState, useState } from 'react'
import { Input, Select } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { MachineAdminRow } from '@modules/scheduling'
import { createMachineAction, setMachineStatusAction } from './actions'

const MACHINE_TYPE_OPTIONS = [
  { value: 'SORTER', label: 'Sorter' },
  { value: 'HULLER', label: 'Huller' },
  { value: 'GRADER', label: 'Grader' },
  { value: 'CLEANER', label: 'Cleaner' },
  { value: 'POLISHER', label: 'Polisher' },
]

const MACHINE_STATUS_OPTIONS = [
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'BREAKDOWN', label: 'Breakdown' },
  { value: 'RETIRED', label: 'Retired' },
]

export function MachinesClient({
  machines,
}: {
  readonly machines: readonly MachineAdminRow[]
}) {
  return (
    <div className="space-y-6">
      <NewMachineForm />
      <MachineTable machines={machines} />
    </div>
  )
}

function NewMachineForm() {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await createMachineAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4"
    >
      <p className="text-sm font-medium">Add a machine</p>
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Code"
          name="code"
          placeholder="SORTER_01"
          hint="Upper case, digits and underscores only."
          error={errors.code}
          required
        />
        <Input label="Name" name="nameEn" error={errors.nameEn} required />
        <Select
          label="Machine type"
          name="machineType"
          options={MACHINE_TYPE_OPTIONS}
          placeholder="Choose a type"
          error={errors.machineType}
          required
        />
        <Input
          label="Rated capacity"
          name="ratedCapacityKgPerHour"
          type="number"
          step="0.001"
          min="0"
          unit="kg/hr"
          numeric
          error={errors.ratedCapacityKgPerHour}
          required
        />
        <Input
          label="Efficiency factor"
          name="efficiencyFactor"
          type="number"
          step="0.001"
          min="0"
          max="1"
          hint="0–1. Defaults to 0.850 if left as-is."
          numeric
          defaultValue="0.850"
          error={errors.efficiencyFactor}
          required
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add machine'}
      </Button>
    </form>
  )
}

function MachineTable({ machines }: { readonly machines: readonly MachineAdminRow[] }) {
  if (machines.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">
        No machines yet. Add the first one above.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] ring-1 ring-[var(--border-subtle)]">
      {machines.map((machine) => (
        <MachineRow key={machine.id} machine={machine} />
      ))}
    </ul>
  )
}

function MachineRow({ machine }: { readonly machine: MachineAdminRow }) {
  const [pending, setPending] = useState(false)

  async function changeStatus(status: string) {
    setPending(true)
    const formData = new FormData()
    formData.set('id', machine.id)
    formData.set('status', status)
    await setMachineStatusAction(formData)
    setPending(false)
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--text-tertiary)]">{machine.code}</span>
          <span className="font-medium">{machine.name}</span>
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {machine.machineType}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
          {machine.ratedCapacityKgPerHour} kg/hr rated, {machine.efficiencyFactor} efficiency
        </p>
      </div>
      <Select
        label="Status"
        name="status"
        className="w-40"
        options={MACHINE_STATUS_OPTIONS}
        value={machine.status}
        disabled={pending}
        onChange={(event) => void changeStatus(event.target.value)}
      />
    </li>
  )
}
