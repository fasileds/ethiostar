'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Select } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import { raiseChargeAction } from './actions'

interface Option {
  readonly id: string
  readonly name: string
}

export function ChargeForm({
  customers,
  branches,
  serviceCodes,
}: {
  readonly customers: readonly Option[]
  readonly branches: readonly Option[]
  readonly serviceCodes: readonly string[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<
    ActionResult<{ chargeEventId: string } | undefined>,
    FormData
  >(
    async (_prev, formData) =>
      (await raiseChargeAction(formData)) as ActionResult<
        { chargeEventId: string } | undefined
      >,
    ACTION_IDLE as ActionResult<{ chargeEventId: string } | undefined>,
  )
  const errors = fieldErrorMap(state)

  if (state.ok && state.data) {
    return (
      <div className="space-y-3">
        <Alert tone="success">Charge raised.</Alert>
        <div className="flex gap-2">
          <Button onClick={() => router.push('/billing')}>Back to billing</Button>
          <Button variant="secondary" onClick={() => router.refresh()}>
            Raise another
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Customer"
          name="customerId"
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
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
        <Select
          label="Service"
          name="serviceCode"
          options={serviceCodes.map((code) => ({ value: code, label: code }))}
          placeholder="Choose a service"
          error={errors.serviceCode}
          required
        />
        <Input
          label="Source type"
          name="sourceType"
          placeholder="goods_receipt, job_order, dispatch_order…"
          error={errors.sourceType}
          required
        />
        <Input
          label="Source record id"
          name="sourceId"
          placeholder="The record's id"
          error={errors.sourceId}
          required
        />
        <Input
          label="Quantity (kg or days)"
          name="quantity"
          hint="Leave blank for a FLAT service."
          error={errors.quantity}
        />
        <Input
          label="Kesha count"
          name="keshaQuantity"
          type="number"
          min={0}
          hint="Only for a PER_KESHA service."
          error={errors.keshaQuantity}
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Raising…' : 'Raise charge'}
      </Button>
    </form>
  )
}
