import type { Metadata } from 'next'
import { ForgotPasswordForm } from '../password/PasswordForms'

export const metadata: Metadata = { title: 'Reset your password' }

export default function ForgotPasswordPage() {
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-2 mb-6 text-sm text-[var(--text-secondary)]">
        Enter the email address on your account and we will send you a link.
      </p>

      <ForgotPasswordForm />
    </div>
  )
}
