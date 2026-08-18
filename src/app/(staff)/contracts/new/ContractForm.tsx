'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Select, Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { CustomerRow } from '@modules/customers'
import type { BranchOption } from '@modules/warehouse'
import { createContractAction } from './actions'

interface CreateContractResult {
  readonly contractId: string
  readonly reference: string
}

export function ContractForm({
  customers,
  branches,
}: {
  readonly customers: readonly CustomerRow[]
  readonly branches: readonly BranchOption[]
}) {
  const router = useRouter()
  type SubmitResult = ActionResult<CreateContractResult | undefined>
  const [state, formAction, pending] = useActionState<SubmitResult, FormData>(
    async (_prev, formData) => createContractAction(formData) as Promise<SubmitResult>,
    ACTION_IDLE,
  )
  const errors = fieldErrorMap(state)

  useEffect(() => {
    if (state.ok && state.data) router.push(`/contracts/${state.data.contractId}`)
  }, [state, router])

  return (
    <form action={formAction} className="space-y-4">
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <Select
        label="Customer"
        name="customerId"
        options={customers.map((c) => ({ value: c.id, label: `${c.legalName} (${c.code})` }))}
        placeholder="Choose a customer"
        error={errors.customerId}
        required
      />

      <Select
        label="Branch"
        name="branchId"
        options={branches.map((b) => ({ value: b.id, label: b.name }))}
        placeholder="Choose a branch"
        error={errors.branchId}
        required
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Effective from"
          name="effectiveFrom"
          type="date"
          error={errors.effectiveFrom}
          required
        />
        <Input
          label="Effective to (optional)"
          name="effectiveTo"
          type="date"
          error={errors.effectiveTo}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Free storage days"
          name="freeStorageDays"
          type="number"
          min={0}
          defaultValue={0}
          error={errors.freeStorageDays}
        />
        <Input
          label="Payment terms (days)"
          name="paymentTermsDays"
          type="number"
          min={0}
          defaultValue={30}
          error={errors.paymentTermsDays}
        />
      </div>

      <Input
        label="Credit limit (optional)"
        name="creditLimitAmount"
        inputMode="decimal"
        placeholder="0.00"
        error={errors.creditLimitAmount}
      />

      <Textarea label="Notes (optional)" name="notes" rows={2} error={errors.notes} />

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Creating…' : 'Create draft contract'}
      </Button>
    </form>
  )
}
