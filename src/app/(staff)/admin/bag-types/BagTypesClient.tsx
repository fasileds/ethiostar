'use client'

import { useActionState, useState } from 'react'
import { Input, Select, Checkbox } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { BagTypeRow } from '@modules/master-data'
import { createBagTypeAction, addBagTypeVersionAction, setBagTypeActiveAction } from './actions'

export function BagTypesClient({ bagTypes }: { readonly bagTypes: readonly BagTypeRow[] }) {
  return (
    <div className="space-y-6">
      <NewBagTypeForm />
      <ul className="space-y-3">
        {bagTypes.map((bagType) => (
          <BagTypeCard key={bagType.id} bagType={bagType} />
        ))}
        {bagTypes.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">
            No bag types yet. Add the first one above.
          </p>
        ) : null}
      </ul>
    </div>
  )
}

function NewBagTypeForm() {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await createBagTypeAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4"
    >
      <p className="text-sm font-medium">Add a bag type</p>
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="Code" name="code" placeholder="JUTE_60KG" error={errors.code} required />
        <Input label="Name" name="nameEn" error={errors.nameEn} required />
        <Input label="Material" name="material" error={errors.material} />
        <Select
          label="Ownership"
          name="ownership"
          options={[
            { value: 'ETHIOSTAR', label: 'EthioStar' },
            { value: 'CUSTOMER', label: 'Customer' },
          ]}
          error={errors.ownership}
          required
        />
        <Input
          label="Standard net weight"
          name="standardNetWeightKg"
          unit="kg"
          numeric
          error={errors.standardNetWeightKg}
          required
        />
        <Input
          label="Tare weight"
          name="tareWeightKg"
          unit="kg"
          numeric
          error={errors.tareWeightKg}
        />
        <Input
          label="Weight tolerance"
          name="weightTolerancePct"
          unit="%"
          numeric
          error={errors.weightTolerancePct}
        />
        <Input
          label="Effective from"
          name="effectiveFrom"
          type="date"
          error={errors.effectiveFrom}
          required
        />
      </div>

      <Checkbox
        label="Returnable to the customer on dispatch"
        name="isReturnable"
        value="true"
      />

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add bag type'}
      </Button>
    </form>
  )
}

function BagTypeCard({ bagType }: { readonly bagType: BagTypeRow }) {
  const [showVersionForm, setShowVersionForm] = useState(false)
  const [togglePending, setTogglePending] = useState(false)

  async function toggle() {
    setTogglePending(true)
    const formData = new FormData()
    formData.set('id', bagType.id)
    formData.set('isActive', String(!bagType.isActive))
    await setBagTypeActiveAction(formData)
    setTogglePending(false)
  }

  return (
    <li className="rounded-[var(--radius-md)] ring-1 ring-[var(--border-subtle)]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[var(--text-tertiary)]">
              {bagType.code}
            </span>
            <span className="font-medium">{bagType.name}</span>
            {!bagType.isActive ? (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                Inactive
              </span>
            ) : null}
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              {bagType.ownership === 'ETHIOSTAR' ? 'EthioStar-owned' : 'Customer-owned'}
            </span>
          </div>
          {bagType.currentVersion ? (
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
              Net {bagType.currentVersion.standardNetWeightKg} kg
              {bagType.currentVersion.tareWeightKg
                ? `, tare ${bagType.currentVersion.tareWeightKg} kg`
                : ''}{' '}
              — effective from {bagType.currentVersion.effectiveFrom}
              {bagType.currentVersion.effectiveTo
                ? ` to ${bagType.currentVersion.effectiveTo}`
                : ''}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">No version on record.</p>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={() => setShowVersionForm((v) => !v)}>
          {showVersionForm ? 'Cancel' : 'Add new version'}
        </Button>
        <Button size="sm" variant="secondary" onClick={toggle} disabled={togglePending}>
          {bagType.isActive ? 'Deactivate' : 'Activate'}
        </Button>
      </div>

      {showVersionForm ? (
        <div className="border-t border-[var(--border-subtle)] px-4 py-3">
          <NewVersionForm bagTypeId={bagType.id} onDone={() => setShowVersionForm(false)} />
        </div>
      ) : null}
    </li>
  )
}

function NewVersionForm({
  bagTypeId,
  onDone,
}: {
  readonly bagTypeId: string
  readonly onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => {
      const result = (await addBagTypeVersionAction(formData)) as ActionResult<void>
      if (result.ok) onDone()
      return result
    },
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form action={formAction} className="space-y-3">
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}
      <input type="hidden" name="bagTypeId" value={bagTypeId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Input
          label="Standard net weight"
          name="standardNetWeightKg"
          unit="kg"
          numeric
          error={errors.standardNetWeightKg}
          required
        />
        <Input
          label="Tare weight"
          name="tareWeightKg"
          unit="kg"
          numeric
          error={errors.tareWeightKg}
        />
        <Input
          label="Weight tolerance"
          name="weightTolerancePct"
          unit="%"
          numeric
          error={errors.weightTolerancePct}
        />
        <Input
          label="Effective from"
          name="effectiveFrom"
          type="date"
          error={errors.effectiveFrom}
          required
        />
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save new version'}
      </Button>
    </form>
  )
}
