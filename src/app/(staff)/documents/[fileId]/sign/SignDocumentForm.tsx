'use client'

import { useActionState, useState } from 'react'
import { Input } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import { SignaturePad, type CapturedSignature } from '@ui/patterns/SignaturePad'
import { ACTION_IDLE, fieldErrorMap, type ActionResult } from '@server/actions/action-result'
import { captureSignatureAction } from './actions'

export interface SignDocumentFormProps {
  readonly fileId: string
  readonly sourceType: string
  readonly sourceId: string
}

type SubmitResult = ActionResult<{ signatureId: string } | undefined>

/** The general-purpose signing form. Captures who is signing, then how — typed or drawn. */
export function SignDocumentForm({ fileId, sourceType, sourceId }: SignDocumentFormProps) {
  const [state, formAction, pending] = useActionState<SubmitResult, FormData>(
    async (_prev, formData) => captureSignatureAction(formData) as Promise<SubmitResult>,
    ACTION_IDLE,
  )
  const errors = fieldErrorMap(state)

  const [signerName, setSignerName] = useState('')
  const [signerRole, setSignerRole] = useState('')
  const [captured, setCaptured] = useState<CapturedSignature | null>(null)

  if (state.ok && state.data?.signatureId) {
    return (
      <Alert tone="success" title="Signature recorded">
        The signature has been saved against this document.
      </Alert>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="fileId" value={fileId} />
      <input type="hidden" name="sourceType" value={sourceType} />
      <input type="hidden" name="sourceId" value={sourceId} />
      {captured ? (
        <>
          <input type="hidden" name="method" value={captured.method} />
          <input type="hidden" name="signatureData" value={captured.signatureData} />
        </>
      ) : null}

      {!state.ok ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <Input
        label="Signer's name"
        name="signerName"
        value={signerName}
        onChange={(event) => setSignerName(event.target.value)}
        error={errors.signerName}
        required
      />
      <Input
        label="Signer's role (optional)"
        name="signerRole"
        value={signerRole}
        onChange={(event) => setSignerRole(event.target.value)}
        error={errors.signerRole}
      />

      {captured ? (
        <div className="flex items-center justify-between rounded-md bg-[var(--surface-sunken)] p-3 text-sm">
          <span className="font-medium">
            {captured.method === 'TYPED'
              ? 'Typed signature captured'
              : 'Drawn signature captured'}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setCaptured(null)}>
            Redo
          </Button>
        </div>
      ) : (
        <SignaturePad onCapture={setCaptured} disabled={pending} />
      )}

      <Button
        type="submit"
        variant="primary"
        disabled={pending || !captured || !signerName.trim()}
      >
        {pending ? 'Saving…' : 'Save signature'}
      </Button>
    </form>
  )
}
