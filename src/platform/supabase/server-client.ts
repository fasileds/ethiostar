import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { env } from '@config/env'

/**
 * Supabase clients for server-side use.
 *
 * Cookie-based session storage only — never localStorage, which is XSS-readable.
 *
 * NOTE: this module deliberately does NOT export an admin (service-role) client.
 * That lives in ./admin-client.ts, which is allow-listed in scripts/guard-service-role.ts,
 * because service_role bypasses RLS. See docs/adr/0013.
 */

/**
 * A client bound to the caller's session, for Server Components, Server Actions and route
 * handlers. `cookies()` is async in Next 16.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Components cannot set cookies. Refresh is handled in proxy.ts, which
          // can — this catch is the documented pattern, not an oversight.
        }
      },
    },
  })
}

/**
 * An anonymous client for genuinely public surfaces (the application form).
 * Carries no session and is subject to `anon` RLS policies, which grant nothing by default.
 */
export function createSupabaseAnonClient() {
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: () => {},
    },
  })
}
