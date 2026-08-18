'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Input } from '@ui/primitives/Field'
import { Alert } from '@ui/primitives/Alert'
import { Button, ButtonLink } from '@ui/primitives/Button'
import { requestPasswordResetAction, setPasswordAction, type PasswordState } from './actions'

const IDLE: PasswordState = {}

/** Request a reset link. */
export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, IDLE)

  // The notice replaces the form entirely. Leaving the form on screen invites a second
  // submit, and the second one looks like it failed because the message never changes.
  if (state.notice) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Check your email">
          {state.notice}
        </Alert>
        <p className="text-sm text-[var(--text-secondary)]">
          Nothing arrived? Check the spam folder, or contact your EthioStar branch — they can
          confirm which address your account uses.
        </p>
        <ButtonLink href="/login" variant="secondary">
          Back to sign in
        </ButtonLink>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Input
        label="Email address"
        name="email"
        type="email"
        required
        autoComplete="email"
        autoFocus
        error={state.fieldErrors?.email}
        hint="We will send a link to reset your password."
      />

      <Button type="submit" disabled={pending} className="w-full" size="lg">
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>

      <p className="text-center text-sm">
        <Link href="/login" className="rounded text-[var(--text-brand)] hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  )
}

/**
 * Set a new password. Used by both the recovery link and the forced first-login change.
 *
 * `autoComplete="new-password"` on both fields so a password manager offers to generate one
 * rather than autofilling the old value.
 */
export function SetPasswordForm({
  submitLabel = 'Set password',
}: {
  readonly submitLabel?: string
}) {
  const [state, formAction, pending] = useActionState(setPasswordAction, IDLE)

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Input
        label="New password"
        name="password"
        type="password"
        required
        autoComplete="new-password"
        autoFocus
        error={state.fieldErrors?.password}
        hint="At least 12 characters. A short phrase you can remember beats a short jumble you cannot."
      />

      <Input
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        required
        autoComplete="new-password"
        error={state.fieldErrors?.confirmPassword}
      />

      <Button type="submit" disabled={pending} className="w-full" size="lg">
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}
