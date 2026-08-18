-- 20260813130000_0024_clear_must_change_password_on_password_change.sql
-- phase:      1
-- module:     M01 Identity — fix
-- ticket:     CPMS-024
-- breaking:   no
-- lock-risk:  none   (new function + trigger)
-- rollback:   forward-fix only
--
-- FIXES: an infinite redirect loop on /first-login — nobody could ever finish their
-- forced password change.
--
-- The loop:
--
--   custom_access_token_hook reads must_change_password from public.app_user
--     → proxy.ts sees must_change_password = true and redirects every path to /first-login
--       → setPasswordAction calls supabase.auth.updateUser({ data: { ... } })
--         → that writes auth.users.raw_user_meta_data, NOT public.app_user
--           → app_user.must_change_password is still true
--             → the next token still says true → back to /first-login, forever
--
-- The profile trigger from 0002 only fires on INSERT, so nothing ever reconciled the two.
--
-- WHY A TRIGGER ON encrypted_password, and not simply letting the application clear it:
--
--   * RLS makes the application route impossible for the case that matters most. The only
--     write policy on app_user is `p_app_user__staff_write`, gated on fn_is_staff() — so a
--     CUSTOMER can never clear their own flag. Their very first action in the system is the
--     forced password change, and it could never complete.
--
--   * A SECURITY DEFINER function callable by `authenticated` would work, but any signed-in
--     user could call it directly and skip the password change entirely — turning a control
--     into a suggestion.
--
--   * `encrypted_password` changing IS the event we care about. Keying off it means the flag
--     clears when, and only when, the password actually changed. It cannot be spoofed by
--     editing user metadata, and it covers every route that sets a password: /first-login,
--     the recovery link, and an administrator resetting one.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.fn_clear_must_change_password()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Same reason as 0023: the audit trigger on app_user refuses a write it cannot attribute,
  -- and GoTrue's connection carries no JWT claims. The subject changing the password is the
  -- actor. Transaction-scoped, so it cannot leak onto a pooled connection.
  PERFORM set_config('app.actor_id', NEW.id::text, true);

  UPDATE public.app_user
     SET must_change_password = false
   WHERE id = NEW.id
     AND must_change_password;   -- no-op write avoided, so no spurious audit row

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_clear_must_change_password() IS
  'Clears app_user.must_change_password when auth.users.encrypted_password actually '
  'changes. The flag lives in app_user because custom_access_token_hook reads it from '
  'there; Supabase writes only raw_user_meta_data. See migration 0024.';

DROP TRIGGER IF EXISTS trg_auth_users__password_changed ON auth.users;

-- `UPDATE OF encrypted_password` narrows it at the catalogue level; the WHEN clause then
-- rejects the updates that touch the column without changing the value.
CREATE TRIGGER trg_auth_users__password_changed
AFTER UPDATE OF encrypted_password ON auth.users
FOR EACH ROW
WHEN (NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password)
EXECUTE FUNCTION public.fn_clear_must_change_password();
