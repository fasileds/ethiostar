'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Select, Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { Card, CardHeader } from '@ui/patterns/Card'
import { OnDate } from '@ui/patterns/DateTime'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import type { ContractRow, TariffLineRow } from '@modules/contracts'
import {
  addContractTariffLineAction,
  activateContractAction,
  terminateContractAction,
} from './actions'

export function ContractDetailClient({
  contract,
  tariffLines,
  serviceCodes,
}: {
  readonly contract: ContractRow
  readonly tariffLines: readonly TariffLineRow[]
  readonly serviceCodes: readonly string[]
}) {
  return (
    <div className="space-y-6">
      <ContractActions contract={contract} />

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Negotiated tariff lines"
            description="Rates this contract overrides on the branch standard tariff. M19 prices a charge against whichever line covers the event date."
          />
        </div>
        <TariffLineTable lines={tariffLines} />
      </Card>

      {contract.status !== 'TERMINATED' ? (
        <Card>
          <CardHeader title="Add a tariff line" />
          <div className="mt-3">
            <AddTariffLineForm
              contractId={contract.id}
              branchId={contract.branchId}
              serviceCodes={serviceCodes}
            />
          </div>
        </Card>
      ) : null}
    </div>
  )
}

function TariffLineTable({ lines }: { readonly lines: readonly TariffLineRow[] }) {
  if (lines.length === 0) {
    return (
      <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
        No negotiated lines yet — this contract prices against the branch standard tariff.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-[var(--border-subtle)]">
      {lines.map((line) => (
        <li key={line.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{line.serviceCode}</p>
            <p className="numeric text-xs text-[var(--text-tertiary)]">
              {line.rateAmount} {line.currency} / {line.uom}
              {line.negotiationReason ? ` — ${line.negotiationReason}` : ''}
            </p>
          </div>
          <OnDate
            value={line.effectiveFrom}
            className="shrink-0 text-xs text-[var(--text-tertiary)]"
          />
          <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
            {line.effectiveTo ? `until ${line.effectiveTo}` : 'open-ended'}
          </span>
        </li>
      ))}
    </ul>
  )
}

function AddTariffLineForm({
  contractId,
  branchId,
  serviceCodes,
}: {
  readonly contractId: string
  readonly branchId: string
  readonly serviceCodes: readonly string[]
}) {
  const [state, formAction, pending] = useActionState<ActionResult<void>, FormData>(
    async (_prev, formData) =>
      (await addContractTariffLineAction(formData)) as ActionResult<void>,
    ACTION_IDLE as ActionResult<void>,
  )
  const errors = fieldErrorMap(state)

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="contractId" value={contractId} />
      <input type="hidden" name="branchId" value={branchId} />
      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Service"
          name="serviceCode"
          options={serviceCodes.map((code) => ({ value: code, label: code }))}
          placeholder="Choose a service"
          error={errors.serviceCode}
          required
        />
        <Select
          label="Unit of measure"
          name="uom"
          options={[
            { value: 'PER_KG', label: 'Per kg' },
            { value: 'PER_KESHA', label: 'Per kesha' },
            { value: 'PER_DAY', label: 'Per day' },
            { value: 'FLAT', label: 'Flat' },
          ]}
          error={errors.uom}
          required
        />
        <Input
          label="Rate"
          name="rateAmount"
          inputMode="decimal"
          placeholder="0.00"
          error={errors.rateAmount}
          required
        />
        <Input
          label="Effective from"
          name="effectiveFrom"
          type="date"
          error={errors.effectiveFrom}
          required
        />
      </div>

      <Textarea
        label="Negotiation reason"
        name="negotiationReason"
        rows={2}
        hint="Required for a negotiated rate — why this differs from the branch standard."
        error={errors.negotiationReason}
      />

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add tariff line'}
      </Button>
    </form>
  )
}

function ContractActions({ contract }: { readonly contract: ContractRow }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  async function activate() {
    setPending(true)
    setError(null)
    const formData = new FormData()
    formData.set('contractId', contract.id)
    const result = await activateContractAction(formData)
    setPending(false)
    if (result.ok) router.refresh()
    else setError(result.error.message)
  }

  async function terminate() {
    if (!reason.trim()) {
      setError('Enter a reason for termination.')
      return
    }
    setPending(true)
    setError(null)
    const formData = new FormData()
    formData.set('contractId', contract.id)
    formData.set('reason', reason)
    const result = await terminateContractAction(formData)
    setPending(false)
    if (result.ok) router.refresh()
    else setError(result.error.message)
  }

  if (contract.status !== 'DRAFT' && contract.status !== 'ACTIVE') return null

  return (
    <Card>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap items-end gap-3">
        {contract.status === 'DRAFT' ? (
          <Button onClick={activate} disabled={pending}>
            {pending ? 'Activating…' : 'Activate contract'}
          </Button>
        ) : null}

        {contract.status === 'ACTIVE' ? (
          <>
            <Input
              label="Termination reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="max-w-xs"
            />
            <Button variant="danger" onClick={terminate} disabled={pending}>
              {pending ? 'Terminating…' : 'Terminate contract'}
            </Button>
          </>
        ) : null}
      </div>
    </Card>
  )
}
