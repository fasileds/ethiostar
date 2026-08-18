'use client'

import { useActionState, useState } from 'react'
import { Select, Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { AvailableSection } from '@modules/inbound'
import { approveDeliveryRequestAction, rejectDeliveryRequestAction } from './actions'

function ErrorAlert({ state }: { readonly state: ActionResult<unknown> }) {
  if (state.ok) return null
  return <Alert tone="danger">{state.error.message}</Alert>
}

export function ApproveForm({
  deliveryRequestId,
  sections,
}: {
  readonly deliveryRequestId: string
  readonly sections: readonly AvailableSection[]
}) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) =>
      (await approveDeliveryRequestAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  if (sections.length === 0) {
    return (
      <Alert tone="warning" title="No section has room for this load">
        Free up space, or ask the customer to reduce the quantity, before approving.
      </Alert>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="deliveryRequestId" value={deliveryRequestId} />
      <ErrorAlert state={state} />
      <Select
        label="Store in"
        name="locationId"
        error={errors.locationId}
        options={sections.map((s) => ({
          value: s.locationId,
          label: `${s.warehouseCode} / ${s.roomCode} / ${s.sectionCode} — ${s.freeKg} kg, ${s.freeKesha} kesha free`,
        }))}
        placeholder="Choose a section"
        required
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Approving…' : 'Approve and reserve space'}
      </Button>
    </form>
  )
}

export function RejectForm({ deliveryRequestId }: { readonly deliveryRequestId: string }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) =>
      (await rejectDeliveryRequestAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  if (!open) {
    return (
      <Button variant="danger" className="w-full" onClick={() => setOpen(true)}>
        Reject
      </Button>
    )
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="deliveryRequestId" value={deliveryRequestId} />
      <ErrorAlert state={state} />
      <Textarea
        label="Reason (shown to the customer)"
        name="reason"
        rows={3}
        error={errors.reason}
        required
      />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          Confirm rejection
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
