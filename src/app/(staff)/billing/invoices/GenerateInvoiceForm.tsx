'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Select } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import { generateInvoiceAction } from './actions'

interface Option {
  readonly id: string
  readonly name: string
}

type Result = ActionResult<{ invoiceId: string; reference: string } | undefined>

export function GenerateInvoiceForm({
  customers,
  branches,
}: {
  readonly customers: readonly Option[]
  readonly branches: readonly Option[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<Result, FormData>(
    async (_prev, formData) => (await generateInvoiceAction(formData)) as Result,
    ACTION_IDLE as Result,
  )
  const errors = fieldErrorMap(state)

  if (state.ok && state.data) {
    return (
      <div className="space-y-2">
        <Alert tone="success">Invoice {state.data.reference} generated as a draft.</Alert>
        <Button onClick={() => router.push(`/billing/invoices/${state.data?.invoiceId}`)}>
          Open invoice
        </Button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
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
        <Input
          label="Period start"
          name="periodStart"
          type="date"
          error={errors.periodStart}
          required
        />
        <Input
          label="Period end"
          name="periodEnd"
          type="date"
          error={errors.periodEnd}
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Generating…' : 'Generate invoice'}
      </Button>
    </form>
  )
}
