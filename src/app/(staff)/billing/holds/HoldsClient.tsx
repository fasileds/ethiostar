'use client'

import { useState } from 'react'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { When } from '@ui/patterns/DateTime'
import type { CreditHoldRow } from '@modules/billing'
import { releaseCreditHoldAction } from './actions'

export function HoldsClient({ hold }: { readonly hold: CreditHoldRow }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [released, setReleased] = useState(false)

  async function release() {
    setPending(true)
    setError(null)
    const formData = new FormData()
    formData.set('holdId', hold.id)
    const result = await releaseCreditHoldAction(formData)
    setPending(false)
    if (result.ok) {
      setReleased(true)
    } else {
      setError(result.error.message)
    }
  }

  if (released) return null

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{hold.customerName}</p>
        <p className="text-xs text-[var(--text-tertiary)]">
          {hold.reason}
          {hold.note ? ` — ${hold.note}` : ''}
        </p>
      </div>
      <When value={hold.heldAt} className="shrink-0 text-xs text-[var(--text-tertiary)]" />
      <Button size="sm" variant="secondary" onClick={release} disabled={pending}>
        {pending ? 'Releasing…' : 'Release'}
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </li>
  )
}
