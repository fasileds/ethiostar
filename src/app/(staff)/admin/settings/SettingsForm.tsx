'use client'

import { useActionState, useState } from 'react'
import { Input, Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, type ActionResult } from '@server/actions/action-result'
import type { SettingRow } from '@modules/administration'
import { updateSettingAction } from './actions'

export function SettingRowEditor({ setting }: { readonly setting: SettingRow }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await updateSettingAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )

  const displayValue =
    typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value)

  return (
    <div className="border-b border-[var(--border-subtle)] py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-sm font-medium">{setting.key}</div>
          <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{setting.description}</p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Current: <span className="numeric font-semibold">{displayValue}</span>
            {setting.unit ? ` ${setting.unit}` : ''}
            {setting.updatedByName ? ` · last changed by ${setting.updatedByName}` : ''}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Cancel' : 'Change'}
        </Button>
      </div>

      {open ? (
        <form action={formAction} className="mt-3 space-y-2">
          <input type="hidden" name="key" value={setting.key} />
          {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="New value"
              name="value"
              defaultValue={displayValue}
              className="w-40"
            />
            <Textarea label="Reason" name="reason" rows={1} className="flex-1" />
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
