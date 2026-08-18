import 'server-only'
import { env } from '@config/env'
import { InfrastructureError } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { createAdminClient } from '@platform/supabase/admin-client'

/**
 * Create a GoTrue user with no password, and return a one-use link to set one.
 *
 * SANCTIONED service-role use, confined to `infrastructure/system/` per
 * scripts/guard-service-role.ts: the GoTrue Admin API always runs as service role — there is
 * no "as this staff member" variant — even though the operation is caused by a named staff
 * action (approving an application). That is exactly the third allow-listed case in
 * docs/adr/0013: an operation genuinely has no per-user credential to run under.
 *
 * `generateLink({ type: 'invite' })`, not `inviteUserByEmail`, and the difference matters:
 * `inviteUserByEmail` creates the user AND sends GoTrue's own built-in email through
 * whatever SMTP `supabase/config.toml` names — a message that never touches
 * `notification.rendered_body` and therefore isn't part of the evidentiary log M04's key
 * control depends on. `generateLink` creates the same user, through the same
 * `raw_user_meta_data` → `fn_handle_new_auth_user()` trigger (migration 0002) that
 * auto-provisions the `app_user` profile, but sends NOTHING — the caller queues its own
 * branded notification carrying the returned link instead.
 */
export interface ProvisionAuthUserInput {
  readonly email: string
  readonly fullName: string
  readonly actorKind: 'staff' | 'customer'
  readonly customerId: string | null
  /** Attribution for `app_user.created_by`, read out of `raw_user_meta_data` by the trigger. */
  readonly createdBy: string
  /** Where the link lands once clicked — `/first-login` for a forced password set. */
  readonly redirectPath: string
  readonly preferredLocale?: 'en' | 'am'
}

export interface ProvisionedAuthUser {
  readonly userId: string
  /** One-use. Embed it in the credential email; never log it, never persist it. */
  readonly actionLink: string
}

export async function provisionAuthUser(
  input: ProvisionAuthUserInput,
): Promise<ProvisionedAuthUser> {
  const { data, error } = await createAdminClient().auth.admin.generateLink({
    type: 'invite',
    email: input.email,
    options: {
      redirectTo: `${env.APP_URL}${input.redirectPath}`,
      data: {
        actor_kind: input.actorKind,
        customer_id: input.customerId,
        full_name: input.fullName,
        must_change_password: true,
        preferred_locale: input.preferredLocale ?? 'en',
        created_by: input.createdBy,
      },
    },
  })

  if (error || !data.user || !data.properties?.action_link) {
    throw new InfrastructureError(ERROR_CODES.INTERNAL, {
      message: `Could not provision a login for ${input.email}: ${error?.message ?? 'no user returned'}`,
      cause: error,
    })
  }

  return { userId: data.user.id, actionLink: data.properties.action_link }
}
