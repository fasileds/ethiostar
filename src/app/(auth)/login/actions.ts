'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServerClient } from '@platform/supabase/server-client'
import { logger } from '@core/logging/logger'

/**
 * Sign in.
 *
 * Goes through Supabase Auth (GoTrue), which owns credentials and sessions —
 * docs/adr/0014-supabase-auth.md. The cookies GoTrue sets are refreshed on every request by
 * proxy.ts; without that a 5-minute access token expires and the user is silently logged
 * out mid-session.
 *
 * NOT wrapped in `withAction`: that wrapper resolves an actor and checks a permission, and
 * this is the one mutation that runs with no actor by definition.
 */

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Enter your password'),
  next: z.string().optional(),
})

export type LoginState = {
  readonly error?: string
  readonly fieldErrors?: Readonly<Record<string, string>>
}

export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { fieldErrors }
  }

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    // Deliberately generic. Distinguishing "no such account" from "wrong password" tells an
    // attacker which addresses are registered — see the threat register, T9.
    logger.warn({ email: parsed.data.email, reason: error.message }, 'sign-in failed')
    return { error: 'Those details do not match an account. Check them and try again.' }
  }

  // The hook's claims sit at the TOP LEVEL of the JWT. `user.app_metadata` is the stored
  // auth.users row, which the hook never writes to, so reading must_change_password from
  // there returned undefined every single time — the forced password change silently never
  // fired and everyone landed on /dashboard. Same for actor_kind, which sent customers into
  // the staff console. See src/server/auth/dal.ts.
  const { data: claimsResult } = await supabase.auth.getClaims()
  const claims = claimsResult?.claims as
    { must_change_password?: boolean; actor_kind?: string } | undefined

  // M04: credentials issued on customer approval force a change before anything else.
  if (claims?.must_change_password === true) redirect('/first-login')

  const home = claims?.actor_kind === 'customer' ? '/portal/dashboard' : '/dashboard'
  const target = parsed.data.next?.startsWith('/') ? parsed.data.next : home
  redirect(target)
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
