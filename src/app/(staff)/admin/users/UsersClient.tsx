'use client'

import { useActionState, useState } from 'react'
import { Input, Select, Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { StatusChip } from '@ui/patterns/StatusChip'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { StaffUserRow } from '@modules/identity'
import { createStaffUserAction, suspendUserAction, reactivateUserAction } from './actions'

const ROLE_OPTIONS = [
  'SYSTEM_ADMINISTRATOR',
  'GENERAL_MANAGER',
  'OPERATIONS_MANAGER',
  'CUSTOMER_SERVICE_OFFICER',
  'STORE_KEEPER',
  'STORE_MANAGER',
  'PRODUCTION_OPERATOR',
  'FINANCE_OFFICER',
  'LABOUR_COORDINATOR',
  'SECURITY_GATE_OFFICER',
  'AUDITOR',
].map((code) => ({ value: code, label: code.replaceAll('_', ' ') }))

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await createStaffUserAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
    >
      {!state.ok ? (
        <div className="sm:col-span-4">
          <Alert tone="danger">{state.error.message}</Alert>
        </div>
      ) : null}
      <Input label="Full name" name="fullName" required error={errors.fullName} />
      <Input label="Email" name="email" type="email" required error={errors.email} />
      <Select
        label="Role"
        name="roleCode"
        options={ROLE_OPTIONS}
        placeholder="Choose a role"
        required
        error={errors.roleCode}
      />
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create user'}
      </Button>
    </form>
  )
}

export function UserRow({ user }: { readonly user: StaffUserRow }) {
  const [suspending, setSuspending] = useState(false)
  const [suspendState, suspendAction, suspendPending] = useActionState<
    ActionResult<void>,
    FormData
  >(
    async (_prev, formData) => (await suspendUserAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const [, reactivateAction, reactivatePending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await reactivateUserAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )

  return (
    <tr className="border-b border-[var(--border-subtle)]">
      <td className="py-2 pr-3">
        <div className="font-medium">{user.fullName}</div>
        <div className="text-xs text-[var(--text-tertiary)]">{user.email}</div>
      </td>
      <td className="py-2 pr-3 text-sm">{user.roles.join(', ') || '—'}</td>
      <td className="py-2 pr-3">
        <StatusChip status={user.status} />
      </td>
      <td className="py-2 text-right">
        {user.status === 'SUSPENDED' ? (
          <form action={reactivateAction}>
            <input type="hidden" name="userId" value={user.id} />
            <Button type="submit" size="sm" variant="secondary" disabled={reactivatePending}>
              Reactivate
            </Button>
          </form>
        ) : suspending ? (
          <form action={suspendAction} className="flex items-center gap-2">
            <input type="hidden" name="userId" value={user.id} />
            {!suspendState.ok ? (
              <span className="text-xs text-danger-700">{suspendState.error.message}</span>
            ) : null}
            <Textarea label="" name="reason" rows={1} placeholder="Reason" className="w-40" />
            <Button type="submit" size="sm" variant="danger" disabled={suspendPending}>
              Confirm
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setSuspending(true)}>
            Suspend
          </Button>
        )}
      </td>
    </tr>
  )
}
