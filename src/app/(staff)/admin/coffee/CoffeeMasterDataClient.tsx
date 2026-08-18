'use client'

import { useActionState, useState } from 'react'
import { Input } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, type ActionResult } from '@server/actions/action-result'
import type {
  CoffeeTypeRow,
  CoffeeGradeRow,
  ScreenSizeRow,
  CertificationRow,
  HarvestYearRow,
} from '@modules/master-data'
import {
  createCoffeeTypeAction,
  setCoffeeTypeActiveAction,
  createCoffeeGradeAction,
  setCoffeeGradeActiveAction,
  createScreenSizeAction,
  setScreenSizeActiveAction,
  createCertificationAction,
  setCertificationActiveAction,
  createHarvestYearAction,
  setHarvestYearActiveAction,
} from './actions'

export function CoffeeMasterDataClient({
  types,
  grades,
  screenSizes,
  certifications,
  harvestYears,
}: {
  readonly types: readonly CoffeeTypeRow[]
  readonly grades: readonly CoffeeGradeRow[]
  readonly screenSizes: readonly ScreenSizeRow[]
  readonly certifications: readonly CertificationRow[]
  readonly harvestYears: readonly HarvestYearRow[]
}) {
  return (
    <div className="space-y-8">
      <Section title="Coffee types">
        <NewRowForm
          action={createCoffeeTypeAction}
          fields={
            <>
              <Input label="Code" name="code" placeholder="WASHED" required />
              <Input label="Name" name="nameEn" required />
              <Input
                label="Mass-balance tolerance"
                name="massBalanceTolerancePct"
                unit="%"
                numeric
              />
            </>
          }
        />
        <SimpleList
          rows={types}
          renderExtra={(row) =>
            row.description ? (
              <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">{row.description}</p>
            ) : null
          }
          toggleAction={setCoffeeTypeActiveAction}
        />
      </Section>

      <Section title="Coffee grades">
        <NewRowForm
          action={createCoffeeGradeAction}
          fields={
            <>
              <Input label="Code" name="code" placeholder="GRADE_1" required />
              <Input label="Name" name="nameEn" required />
            </>
          }
        />
        <SimpleList rows={grades} toggleAction={setCoffeeGradeActiveAction} />
      </Section>

      <Section title="Screen sizes">
        <NewRowForm
          action={createScreenSizeAction}
          fields={
            <>
              <Input label="Code" name="code" placeholder="SCR_16" required />
              <Input label="Name" name="nameEn" required />
            </>
          }
        />
        <SimpleList rows={screenSizes} toggleAction={setScreenSizeActiveAction} />
      </Section>

      <Section title="Certifications">
        <NewRowForm
          action={createCertificationAction}
          fields={
            <>
              <Input label="Code" name="code" placeholder="ORGANIC" required />
              <Input label="Name" name="nameEn" required />
              <Input label="Issuing body" name="issuingBody" />
            </>
          }
        />
        <SimpleList rows={certifications} toggleAction={setCertificationActiveAction} />
      </Section>

      <Section title="Harvest years">
        <NewRowForm
          action={createHarvestYearAction}
          fields={
            <>
              <Input label="Code" name="code" placeholder="2025_26" required />
              <Input label="Name" name="nameEn" required />
              <Input label="Starts on" name="startsOn" type="date" required />
              <Input label="Ends on" name="endsOn" type="date" required />
            </>
          }
        />
        <SimpleList rows={harvestYears} toggleAction={setHarvestYearActiveAction} />
      </Section>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  readonly title: string
  readonly children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-[var(--text-secondary)]">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function NewRowForm({
  action,
  fields,
}: {
  readonly action: (formData: FormData) => Promise<ActionResult<void>>
  readonly fields: React.ReactNode
}) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await action(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
    >
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{fields}</div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Adding…' : 'Add'}
      </Button>
    </form>
  )
}

interface ToggleableRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly isActive: boolean
}

function SimpleList<T extends ToggleableRow>({
  rows,
  toggleAction,
  renderExtra,
}: {
  readonly rows: readonly T[]
  readonly toggleAction: (formData: FormData) => Promise<ActionResult<void>>
  readonly renderExtra?: ((row: T) => React.ReactNode) | undefined
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-tertiary)]">No rows yet.</p>
  }

  return (
    <ul className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] ring-1 ring-[var(--border-subtle)]">
      {rows.map((row) => (
        <RowItem key={row.id} row={row} toggleAction={toggleAction} renderExtra={renderExtra} />
      ))}
    </ul>
  )
}

function RowItem<T extends ToggleableRow>({
  row,
  toggleAction,
  renderExtra,
}: {
  readonly row: T
  readonly toggleAction: (formData: FormData) => Promise<ActionResult<void>>
  readonly renderExtra?: ((row: T) => React.ReactNode) | undefined
}) {
  const [pending, setPending] = useState(false)

  async function toggle() {
    setPending(true)
    const formData = new FormData()
    formData.set('id', row.id)
    formData.set('isActive', String(!row.isActive))
    await toggleAction(formData)
    setPending(false)
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--text-tertiary)]">{row.code}</span>
          <span className="font-medium">{row.name}</span>
          {!row.isActive ? (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              Inactive
            </span>
          ) : null}
        </div>
        {renderExtra?.(row)}
      </div>
      <Button size="sm" variant="secondary" onClick={toggle} disabled={pending}>
        {row.isActive ? 'Deactivate' : 'Activate'}
      </Button>
    </li>
  )
}
