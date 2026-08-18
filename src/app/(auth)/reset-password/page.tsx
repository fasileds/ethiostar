import type { Metadata } from 'next'
import { SetPasswordForm } from '../password/PasswordForms'

export const metadata: Metadata = {
  title: 'Choose a new password',
  // Reached through a one-time recovery link; there is nothing here to index.
  robots: { index: false, follow: false },
}

/**
 * The target of the recovery email.
 *
 * Supabase establishes a session from the recovery token before this renders, so the form
 * only has to set the new password. If the link has expired there is no session, and the
 * action says so rather than failing silently.
 */
export const dynamic = 'force-dynamic'

export default function ResetPasswordPage() {
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-2 mb-6 text-sm text-[var(--text-secondary)]">
        Pick something you have not used elsewhere. You will be signed in once it is saved.
      </p>

      <SetPasswordForm submitLabel="Save and sign in" />
    </div>
  )
}
