import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '@config/env'

/**
 * THE SERVICE-ROLE SUPABASE CLIENT. Allow-listed in scripts/guard-service-role.ts.
 *
 * This key bypasses RLS on the database and every policy on Storage. It exists for the two
 * operations GoTrue and Storage will not perform any other way:
 *
 *   1. `auth.admin.*` — creating a customer's user at approval and issuing the activation
 *      link. The applicant has no session yet, so there is no user context to act as.
 *   2. Storage writes to the private bucket, and minting signed download URLs. The bytes
 *      are served after the SAME authorisation check the owning record uses; the object key
 *      is never a permission.
 *
 * IT MUST NEVER REACH THE BROWSER. Three things enforce that rather than one:
 *   - `server-only` makes an import from a Client Component a build error.
 *   - CI scans the built client bundle for the key.
 *   - `env` refuses to boot if the service-role key equals the anon key.
 *
 * `persistSession: false` matters: this client is shared across requests and must never
 * acquire a user's session, which is precisely how a privileged client becomes a
 * cross-tenant leak.
 *
 * docs/adr/0013-supabase-as-database-platform.md
 */

let client: SupabaseClient | undefined

export function createAdminClient(): SupabaseClient {
  client ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return client
}
