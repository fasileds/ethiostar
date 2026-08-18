-- 20260813150000_0026_actor_context_on_auth_user_delete.sql
-- phase:      1
-- module:     M01 Identity — fix
-- ticket:     CPMS-026
-- breaking:   no
-- lock-risk:  none   (new function + trigger)
-- rollback:   forward-fix only
--
-- FIXES: deleting a user was impossible.
--
--     DELETE /auth/v1/admin/users/<id>
--     → 500 {"code":"P0001",
--            "message":"No acting user in context: every write must be attributable
--                       to a named user"}
--
-- `app_user.id` is `REFERENCES auth.users(id) ON DELETE CASCADE`. Removing the auth user
-- cascades a DELETE onto public.app_user, whose audit trigger calls fn_current_actor_id()
-- — and GoTrue's connection carries no JWT claims and no app.actor_id, exactly as in 0023.
--
-- 0023 covered INSERT and 0024 covered the password UPDATE. DELETE was the remaining hole,
-- and it is the one that only shows up when someone tries to remove a mistake: a test
-- account, a duplicate, or a person who never joined.
--
-- BEFORE DELETE on auth.users, so the context is already set when the cascade fires. The
-- actor is the subject being deleted, which is the correct attribution — the audit row
-- records that this user's profile was removed, and there is no other identity available
-- inside a cascade.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.fn_set_actor_for_auth_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('app.actor_id', OLD.id::text, true);
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.fn_set_actor_for_auth_user_delete() IS
  'Supplies app.actor_id before auth.users deletion cascades into public.app_user, whose '
  'audit trigger refuses an unattributable write. See migration 0026.';

DROP TRIGGER IF EXISTS trg_auth_users__before_delete ON auth.users;

CREATE TRIGGER trg_auth_users__before_delete
BEFORE DELETE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_actor_for_auth_user_delete();
