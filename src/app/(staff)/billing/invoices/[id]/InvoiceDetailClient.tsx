'use client'

import { useActionState, useState } from 'react'
import { Input, Select, Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { Card, CardHeader } from '@ui/patterns/Card'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { InvoiceRow } from '@modules/billing'
import { issueInvoiceAction, voidInvoiceAction, recordPaymentAction } from '../actions'
import { printDocumentAction } from '../../../printing/actions'

export function InvoiceDetailClient({ invoice }: { readonly invoice: InvoiceRow }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Actions" />
        <div className="mt-3 flex flex-wrap gap-2">
          {invoice.status === 'DRAFT' ? <IssueButton invoiceId={invoice.id} /> : null}
          {invoice.status === 'DRAFT' || invoice.status === 'ISSUED' ? (
            <VoidForm invoiceId={invoice.id} />
          ) : null}
          <PrintButton invoiceId={invoice.id} documentType="INV" label="Print invoice" />
          <PrintButton invoiceId={invoice.id} documentType="PFI" label="Print proforma" />
        </div>
      </Card>

      {invoice.status !== 'DRAFT' && invoice.status !== 'VOID' ? (
        <Card>
          <CardHeader title="Record a payment" />
          <PaymentForm
            invoiceId={invoice.id}
            customerId={invoice.customerId}
            currency={invoice.currency}
          />
        </Card>
      ) : null}
    </div>
  )
}

function IssueButton({ invoiceId }: { readonly invoiceId: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function issue() {
    setPending(true)
    setError(null)
    const formData = new FormData()
    formData.set('invoiceId', invoiceId)
    const result = await issueInvoiceAction(formData)
    setPending(false)
    if (!result.ok) setError(result.error.message)
  }

  return (
    <div className="space-y-1">
      <Button onClick={issue} disabled={pending}>
        {pending ? 'Issuing…' : 'Issue invoice'}
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  )
}

function VoidForm({ invoiceId }: { readonly invoiceId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) => (await voidInvoiceAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Textarea
        label="Void reason"
        name="reason"
        rows={1}
        error={errors.reason}
        className="min-w-64"
      />
      <Button variant="danger" type="submit" disabled={pending}>
        {pending ? 'Voiding…' : 'Void invoice'}
      </Button>
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}
    </form>
  )
}

function PaymentForm({
  invoiceId,
  customerId,
  currency,
}: {
  readonly invoiceId: string
  readonly customerId: string
  readonly currency: string
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult<{ paymentId: string } | undefined>,
    FormData
  >(
    async (_prev, formData) =>
      (await recordPaymentAction(formData)) as ActionResult<{ paymentId: string } | undefined>,
    ACTION_IDLE as ActionResult<{ paymentId: string } | undefined>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="currency" value={currency} />
      {state.ok && state.data ? <Alert tone="success">Payment recorded.</Alert> : null}
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Input label="Amount" name="amount" error={errors.amount} required />
        <Select
          label="Method"
          name="method"
          options={[
            { value: 'CASH', label: 'Cash' },
            { value: 'BANK_TRANSFER', label: 'Bank transfer' },
            { value: 'CHEQUE', label: 'Cheque' },
            { value: 'MOBILE_MONEY', label: 'Mobile money' },
          ]}
          error={errors.method}
          required
        />
        <Input
          label="External reference"
          name="externalReference"
          error={errors.externalReference}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Recording…' : 'Record payment'}
      </Button>
    </form>
  )
}

/** Renders the invoice/proforma PDF once, then links straight to the download — the same
 *  pattern as `receiving/new/ReceiveForm.tsx`'s `PrintGrnButton`. */
function PrintButton({
  invoiceId,
  documentType,
  label,
}: {
  readonly invoiceId: string
  readonly documentType: 'INV' | 'PFI'
  readonly label: string
}) {
  const [pending, setPending] = useState(false)
  const [printedDocumentId, setPrintedDocumentId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function print() {
    setPending(true)
    setError(null)
    const formData = new FormData()
    formData.set('documentType', documentType)
    formData.set('sourceId', invoiceId)
    const result = await printDocumentAction(formData)
    setPending(false)
    if (result.ok) {
      setPrintedDocumentId(result.data.printedDocumentId)
    } else {
      setError(result.error.message)
    }
  }

  if (printedDocumentId) {
    return (
      <a
        href={`/api/v1/documents/${printedDocumentId}/pdf`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-9 items-center justify-center rounded-md bg-brand-700 px-3.5 text-base font-medium text-white shadow-xs hover:bg-brand-800"
      >
        Download
      </a>
    )
  }

  return (
    <div className="space-y-1">
      <Button variant="secondary" onClick={print} disabled={pending}>
        {pending ? 'Preparing…' : label}
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  )
}
