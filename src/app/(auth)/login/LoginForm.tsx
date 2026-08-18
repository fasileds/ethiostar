'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Button } from '@ui/primitives/Button'
import { Input } from '@ui/primitives/Field'
import { Alert } from '@ui/primitives/Alert'
import { loginAction, type LoginState } from './actions'

/**
 * The sign-in form.
 *
 * Uses `useActionState`, so it submits and shows errors WITHOUT JavaScript as well as with
 * it — the plant's connection is not guaranteed, and a login that needs a hydrated bundle to
 * work is a login that fails on the worst day.
 */
export function LoginForm({ next }: { readonly next?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {})

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
          Staff and customers use the same sign-in.
        </p>
      </header>

      {state.error ? (
        <div className="mb-5">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      ) : null}

      <form action={formAction} className="space-y-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <Input
          label="Email address"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          placeholder="you@company.com"
          error={state.fieldErrors?.email}
        />

        <div>
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            error={state.fieldErrors?.password}
          />
          <div className="mt-2 text-right">
            <Link
              href="/forgot-password"
              className="rounded text-xs font-medium text-[var(--text-brand)] hover:underline"
            >
              Forgotten your password?
            </Link>
          </div>
        </div>

        <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="mt-8 border-t border-[var(--border-subtle)] pt-6">
        <p className="text-sm text-[var(--text-secondary)]">
          Not yet an EthioStar customer?{' '}
          <Link
            href="/apply"
            className="rounded font-medium text-[var(--text-brand)] hover:underline"
          >
            Apply to use our service
          </Link>
        </p>
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">
          Accounts are created by EthioStar when an application is approved. You will receive an
          activation link by email — we never send passwords.
        </p>
      </div>
    </div>
  )
}
