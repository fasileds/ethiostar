import type { Metadata } from 'next'
import { SetPasswordForm } from '../password/PasswordForms'

export const metadata: Metadata = {
  title: 'Set your password',
  robots: { index: false, follow: false },
}

/**
 * The forced password change on first sign-in.
 *
 * EthioStar issues credentials when a customer application is approved, so the first password
 * a user has is one somebody else chose. `must_change_password` on the account routes them
 * here, and nothing else is reachable until it is cleared — which only happens by completing
 * this form.
 */
export const dynamic = 'force-dynamic'

export default function FirstLoginPage() {
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Set your password</h1>
      <p className="mt-2 mb-6 text-sm text-[var(--text-secondary)]">
        Your account was created with a temporary password. Choose your own before you continue
        — nobody at EthioStar can see it.
      </p>

      <SetPasswordForm submitLabel="Set password and continue" />
    </div>
  )
}
