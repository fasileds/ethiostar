'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServerClient } from '@platform/supabase/server-client'
import { logger } from '@core/logging/logger'
import { env } from '@config/env'

/**
 * Password recovery and change.
 *
 * Like sign-in, these are NOT wrapped in `withAction` — recovery runs with no actor by
 * definition, and the change path runs for a user who may not yet be allowed to do anything
 * else (`must_change_password`).
 *
 * Supabase Auth owns credentials; nothing here touches a password hash. See ADR 0014.
 */

export type PasswordState = {
  readonly error?: string
  readonly notice?: string
  readonly fieldErrors?: Readonly<Record<string, string>>
}

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return fieldErrors
}

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
})

/**
 * Request a reset link.
 *
 * ALWAYS reports success, whether or not the address exists. Saying "no account with that
 * email" turns this form into a membership oracle — anyone can test an address list against
 * it. Threat register T9.
 */
export async function requestPasswordResetAction(
  _previous: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const parsed = emailSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.APP_URL}/reset-password`,
  })

  if (error) {
    // Logged, never shown. The user sees the same message either way.
    logger.warn({ reason: error.message }, 'password reset request failed')
  }

  return {
    notice:
      'If that email address has an account, we have sent a link to reset the password. It expires in one hour.',
  }
}

/**
 * The password policy.
 *
 * Length over composition rules. NIST dropped the mandatory-symbol advice years ago because
 * it pushes people towards `Password1!` and a sticky note; a longer passphrase is both
 * stronger and likelier to be remembered by someone standing in a warehouse.
 */
const MIN_LENGTH = 12

const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(MIN_LENGTH, `Use at least ${MIN_LENGTH} characters.`)
      .max(200, 'That is longer than we can store.'),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match.',
  })

/**
 * Set a new password.
 *
 * Serves both the recovery link and the forced first-login change: in both cases Supabase has
 * already established a session (from the recovery token, or from sign-in), so `updateUser`
 * is the whole operation.
 *
 * Clearing `must_change_password` is deliberate and happens here rather than in a trigger —
 * the flag exists to force exactly this action, so this is the only place that may clear it.
 */
export async function setPasswordAction(
  _previous: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })

  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) }

  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      error: 'This link has expired or has already been used. Request a new one and try again.',
    }
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
    data: { must_change_password: false },
  })

  if (error) {
    logger.warn({ userId: user.id, reason: error.message }, 'password change failed')

    // Supabase refuses a password that appears in its breach list, among other reasons. The
    // message is worth passing through: it tells the user something actionable, and it does
    // not reveal anything an attacker does not already know.
    return { error: error.message }
  }

  logger.info({ userId: user.id }, 'password changed')

  // The change cleared app_user.must_change_password (migration 0024), but the access token
  // sitting in the cookie was minted BEFORE that and still asserts the old value. proxy.ts
  // reads the token, so without a refresh it bounces the user straight back to /first-login
  // — they set a new password and appear to be stuck on the same screen. Refreshing mints a
  // new token through the hook, which re-reads app_user.
  await supabase.auth.refreshSession()

  // Read the realm from the JWT, not from `user.app_metadata` — the hook writes its claims
  // at the top level and never touches the stored user row, so app_metadata has no
  // actor_kind and every customer was being sent to the staff console.
  const { data: claimsResult } = await supabase.auth.getClaims()
  const claims = claimsResult?.claims as { actor_kind?: string } | undefined

  redirect(claims?.actor_kind === 'customer' ? '/portal/dashboard' : '/dashboard')
}
