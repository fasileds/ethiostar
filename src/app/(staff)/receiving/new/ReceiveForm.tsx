'use client'

import { useActionState, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Select, Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { AvailableSection, GoodsReceiptResult, FormOption } from '@modules/inbound'
import { createGoodsReceiptAction } from './actions'
import { printDocumentAction } from '../../printing/actions'

export interface ReceiveFormProps {
  readonly deliveryRequestId: string
  readonly sections: readonly AvailableSection[]
  readonly bagTypes: readonly FormOption[]
  readonly coffeeTypes: readonly FormOption[]
  readonly coffeeGrades: readonly FormOption[]
  readonly declaredQuantityKg: string
  readonly declaredKeshaCount: number
}

type SubmitResult = ActionResult<GoodsReceiptResult | undefined>

interface LineDraft {
  readonly key: number
  readonly quantityKg: string
  readonly keshaCount: number | string
}

/**
 * One line per bag type unloaded off the truck. A single truck routinely carries more than one
 * bag type for the same customer — the underlying use case has always accepted an array of
 * lines; this is the form catching up to it.
 */
export function ReceiveForm({
  deliveryRequestId,
  sections,
  bagTypes,
  coffeeTypes,
  coffeeGrades,
  declaredQuantityKg,
  declaredKeshaCount,
}: ReceiveFormProps) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<SubmitResult, FormData>(
    async (_prev, formData) => createGoodsReceiptAction(formData) as Promise<SubmitResult>,
    ACTION_IDLE,
  )
  const errors = fieldErrorMap(state)

  const nextKey = useRef(1)
  const [lines, setLines] = useState<LineDraft[]>([
    { key: 0, quantityKg: declaredQuantityKg, keshaCount: declaredKeshaCount },
  ])

  function addLine() {
    setLines((prev) => [...prev, { key: nextKey.current++, quantityKg: '', keshaCount: '' }])
  }

  function removeLine(key: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((line) => line.key !== key)))
  }

  if (state.ok && state.data?.receiptId) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title={`Goods receipt ${state.data.reference} posted`}>
          <div className="space-y-1">
            <p>
              {state.data.receivedQuantityKg} kg in {state.data.receivedKeshaCount} kesha
              {state.data.averageKgPerKesha
                ? ` (avg ${state.data.averageKgPerKesha} kg/kesha)`
                : ''}
              .
            </p>
            {state.data.varianceKg && state.data.varianceKg !== '0.000' ? (
              <p>
                Variance against declared: {state.data.varianceKg} kg
                {state.data.variancePct ? ` (${state.data.variancePct}%)` : ''}.
              </p>
            ) : null}
          </div>
        </Alert>
        <PrintGrnButton receiptId={state.data.receiptId} />
        <Button onClick={() => router.push('/receiving')}>Back to receiving</Button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="deliveryRequestId" value={deliveryRequestId} />
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

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

      <div className="space-y-3">
        {lines.map((line, index) => (
          <div
            key={line.key}
            className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                Line {index + 1}
                {lines.length > 1 ? ` of ${lines.length}` : ''}
              </p>
              {lines.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLine(line.key)}
                >
                  Remove
                </Button>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Quantity received (kg)"
                name="quantityKg"
                id={`line-${line.key}-quantityKg`}
                inputMode="decimal"
                defaultValue={line.quantityKg}
                required
                touch
                error={errors[`quantityKg.${index}`]}
              />
              <Input
                label="Kesha counted"
                name="keshaCount"
                id={`line-${line.key}-keshaCount`}
                type="number"
                min={1}
                defaultValue={line.keshaCount}
                required
                touch
                error={errors[`keshaCount.${index}`]}
              />

              <Select
                label="Bag type"
                name="bagTypeId"
                id={`line-${line.key}-bagTypeId`}
                options={bagTypes.map((o) => ({ value: o.id, label: o.name }))}
                placeholder="Not specified"
                error={errors[`bagTypeId.${index}`]}
              />
              <Select
                label="Coffee type"
                name="coffeeTypeId"
                id={`line-${line.key}-coffeeTypeId`}
                options={coffeeTypes.map((o) => ({ value: o.id, label: o.name }))}
                placeholder="Not specified"
                error={errors[`coffeeTypeId.${index}`]}
              />
              <Select
                label="Grade"
                name="coffeeGradeId"
                id={`line-${line.key}-coffeeGradeId`}
                options={coffeeGrades.map((o) => ({ value: o.id, label: o.name }))}
                placeholder="Not specified"
                error={errors[`coffeeGradeId.${index}`]}
              />
            </div>
          </div>
        ))}
      </div>

      {errors.quantityKg ? <Alert tone="danger">{errors.quantityKg}</Alert> : null}

      <Button type="button" variant="secondary" onClick={addLine}>
        + Add another bag type
      </Button>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Vehicle plate" name="vehiclePlate" />
        <Input label="Driver name" name="driverName" />
        <Input label="Customer representative" name="customerRepName" />
      </div>

      <Textarea label="Notes (optional)" name="notes" rows={2} error={errors.notes} />

      <Button type="submit" size="touch" disabled={pending} className="w-full">
        {pending ? 'Posting…' : 'Post goods receipt'}
      </Button>
    </form>
  )
}

/** Renders the GRN PDF once, then links straight to the download. */
function PrintGrnButton({ receiptId }: { readonly receiptId: string }) {
  const [pending, setPending] = useState(false)
  const [printedDocumentId, setPrintedDocumentId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function print() {
    setPending(true)
    setError(null)
    const formData = new FormData()
    formData.set('documentType', 'GRN')
    formData.set('sourceId', receiptId)
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
        Download GRN
      </a>
    )
  }

  return (
    <div className="space-y-1">
      <Button variant="secondary" onClick={print} disabled={pending}>
        {pending ? 'Preparing GRN…' : 'Print GRN'}
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  )
}
