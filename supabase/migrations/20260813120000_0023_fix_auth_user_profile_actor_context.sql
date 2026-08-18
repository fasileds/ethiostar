-- 20260813120000_0023_fix_auth_user_profile_actor_context.sql
-- phase:      1
-- module:     M01 Identity — fix
-- ticket:     CPMS-023
-- breaking:   no
-- lock-risk:  none   (function replacement only)
-- rollback:   forward-fix only
--
-- FIXES: no user could be created through Supabase Auth at all.
--
-- The chain:
--
--   GoTrue inserts auth.users
--     → trg_auth_users__create_profile fires
--       → fn_handle_new_auth_user inserts public.app_user
--         → trg_app_user__audit fires
--           → fn_audit_row calls fn_current_actor_id
--             → RAISE 'No acting user in context: every write must be attributable
--                      to a named user'
--
-- fn_current_actor_id reads `request.jwt.claim.sub`, then falls back to `app.actor_id`.
-- GoTrue's own connection sets neither — it is not our pool and never passes through
-- withAuthenticatedDb() — so the insert always aborts and the whole signup fails.
--
-- This affected EVERY route to a new account, not just the first administrator: the
-- Auth Admin API, invites, and the credential-issue flow that runs when a customer
-- application is approved.
--
-- The fix sets the actor for the duration of the statement. Attributing the creation of a
-- profile to the profile's own subject is not a weakening of the control — it is the same
-- identity the function already writes into `created_by` on the line below, and there is no
-- other actor in existence at that instant. `set_config(..., true)` is transaction-scoped,
-- so nothing leaks into the next statement on a pooled connection.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.fn_handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_kind  text := COALESCE(NEW.raw_user_meta_data ->> 'actor_kind', 'staff');
  v_customer_id uuid;
BEGIN
  IF (NEW.raw_user_meta_data ->> 'customer_id') IS NOT NULL THEN
    v_customer_id := (NEW.raw_user_meta_data ->> 'customer_id')::uuid;
  END IF;

  -- The audit trigger on app_user demands an attributable actor. GoTrue's connection has
  -- no JWT claims and no app.actor_id, so supply one for this transaction: the new user is
  -- the author of their own profile row.
  PERFORM set_config('app.actor_id', NEW.id::text, true);

  INSERT INTO public.app_user (
    id, actor_kind, customer_id, email, full_name,
    must_change_password, preferred_locale, created_by
  ) VALUES (
    NEW.id,
    v_actor_kind,
    v_customer_id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data ->> 'must_change_password')::boolean, true),
    COALESCE(NEW.raw_user_meta_data ->> 'preferred_locale', 'en'),
    COALESCE((NEW.raw_user_meta_data ->> 'created_by')::uuid, NEW.id)
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_handle_new_auth_user() IS
  'Creates the public.app_user profile for a new auth.users row. Sets app.actor_id first '
  'so the audit trigger on app_user has an attributable actor — GoTrue''s connection '
  'carries no JWT claims. See migration 0023.';
