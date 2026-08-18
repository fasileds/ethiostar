'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Select, Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { FormOption } from '@modules/inbound'
import { submitDeliveryRequestAction } from './actions'

export interface NewRequestFormProps {
  readonly coffeeTypes: readonly FormOption[]
  readonly harvestYears: readonly FormOption[]
  readonly disabled?: boolean
}

type SubmitResult = ActionResult<{ deliveryRequestId: string; reference: string } | undefined>

export function NewRequestForm({
  coffeeTypes,
  harvestYears,
  disabled = false,
}: NewRequestFormProps) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<SubmitResult, FormData>(
    async (_previous, formData) =>
      submitDeliveryRequestAction(formData) as Promise<SubmitResult>,
    ACTION_IDLE,
  )
  const errors = fieldErrorMap(state)

  if (state.ok && state.data?.reference) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Request submitted">
          Reference {state.data.reference}. We&rsquo;ll let you know once it&rsquo;s reviewed.
        </Alert>
        <Button onClick={() => router.push('/portal/delivery-requests')}>
          Back to my delivery requests
        </Button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Coffee type"
          name="coffeeTypeId"
          placeholder="Not sure yet"
          options={coffeeTypes.map((option) => ({ value: option.id, label: option.name }))}
          error={errors.coffeeTypeId}
          disabled={disabled}
        />

        <Select
          label="Harvest year"
          name="harvestYearId"
          placeholder="Not sure yet"
          options={harvestYears.map((option) => ({ value: option.id, label: option.name }))}
          error={errors.harvestYearId}
          disabled={disabled}
        />

        <Input
          label="Quantity (kg)"
          name="declaredQuantityKg"
          inputMode="decimal"
          required
          error={errors.declaredQuantityKg}
          disabled={disabled}
        />
        <Input
          label="Kesha count"
          name="declaredKeshaCount"
          type="number"
          min={1}
          required
          error={errors.declaredKeshaCount}
          disabled={disabled}
        />

        <Input
          label="Expected arrival date"
          name="expectedArrivalOn"
          type="date"
          required
          error={errors.expectedArrivalOn}
          disabled={disabled}
        />
        <Input
          label="Arrival window (optional)"
          name="expectedArrivalWindow"
          placeholder="e.g. morning"
          disabled={disabled}
        />

        <Input label="Vehicle plate" name="vehiclePlate" disabled={disabled} />
        <Input
          label="Transport mode"
          name="transportMode"
          placeholder="Truck"
          disabled={disabled}
        />
        <Input label="Driver name" name="driverName" disabled={disabled} />
        <Input label="Driver phone" name="driverPhone" disabled={disabled} />
      </div>

      <Textarea
        label="Notes (optional)"
        name="notes"
        rows={3}
        error={errors.notes}
        disabled={disabled}
      />

      <Button
        type="submit"
        size="lg"
        disabled={pending || disabled}
        className="w-full sm:w-auto"
      >
        {pending ? 'Submitting…' : 'Submit request'}
      </Button>
    </form>
  )
}
