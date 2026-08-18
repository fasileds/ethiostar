-- 20260813140000_0025_rename_scope_claim_reserved_collision.sql
-- phase:      1
-- module:     M01 Identity — fix
-- ticket:     CPMS-025
-- breaking:   no   (the claim it renames was never read by anything)
-- lock-risk:  none (function replacement only)
-- rollback:   forward-fix only
--
-- FIXES: every authenticated GoTrue call failing with `bad_jwt`, which made sign-in
-- unusable the moment the access-token hook was switched on.
--
--     {"code":403,"error_code":"bad_jwt",
--      "msg":"invalid JWT: ... could not JSON decode claim:
--             json: cannot unmarshal array into Go struct field
--             AccessTokenClaims.scope of type string"}
--
-- `scope` is a RESERVED claim. It is part of the OAuth 2.0 token response spec (RFC 6749
-- §5.1), and GoTrue types it as a plain space-delimited `string` on its AccessTokenClaims
-- struct. The hook was emitting an ARRAY of {kind, id} objects under that name, so GoTrue
-- could no longer parse tokens it had just issued.
--
-- The blast radius was everything that validates a JWT server-side: `getUser()` in
-- src/proxy.ts (so every request looked unauthenticated and bounced to /login),
-- `updateUser()` (so the forced password change could never complete), sign-out, and token
-- refresh. Sign-in itself succeeded, because issuing a token does not require parsing one —
-- which is exactly why this looked like "it logs in but nothing works".
--
-- The claim is renamed to `app_scope`. Nothing reads it: `AppJwtClaims` in
-- src/server/auth/dal.ts does not declare it, and the DAL resolves scopes from the
-- `user_scope` table on every request rather than trusting the token. It is kept rather
-- than dropped because it is cheap and a client may want it later — under a name that is
-- ours, in the namespace the other custom claims already use.
--
-- Lesson for anyone adding a claim here: the reserved set is not just `sub`/`exp`/`aud`.
-- `scope`, `role`, `iss`, `aal`, `amr`, `session_id` and `email` are all already meaningful
-- to GoTrue. Prefix anything new.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claims  jsonb;
  v_user    public.app_user%ROWTYPE;
  v_role    text;
  v_scope   jsonb;
BEGIN
  SELECT * INTO v_user FROM public.app_user WHERE id = (event ->> 'user_id')::uuid;

  v_claims := event -> 'claims';

  IF NOT FOUND THEN
    -- No profile: emit a claim that fails closed rather than defaulting to something
    -- permissive. Nothing in the application treats an unknown actor_kind as authorised.
    v_claims := jsonb_set(v_claims, '{actor_kind}', '"unknown"');
    RETURN jsonb_set(event, '{claims}', v_claims);
  END IF;

  -- Primary role. Full permission resolution stays in the application; the JWT carries
  -- only what RLS and the UI shell need.
  SELECT r.code INTO v_role
  FROM public.user_role ur
  JOIN public.role r ON r.id = ur.role_id
  WHERE ur.user_id = v_user.id
    AND r.is_active
    AND (ur.expires_at IS NULL OR ur.expires_at > now())
  ORDER BY r.is_system DESC, r.code
  LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object('kind', us.scope_kind, 'id', us.scope_id))
  INTO v_scope
  FROM public.user_scope us
  WHERE us.user_id = v_user.id;

  v_claims := jsonb_set(v_claims, '{actor_kind}',           to_jsonb(v_user.actor_kind));
  v_claims := jsonb_set(v_claims, '{customer_id}',          COALESCE(to_jsonb(v_user.customer_id), 'null'::jsonb));
  v_claims := jsonb_set(v_claims, '{app_role}',             COALESCE(to_jsonb(v_role), 'null'::jsonb));
  -- `app_scope`, NOT `scope` — see the header. GoTrue reserves `scope` as a string.
  v_claims := jsonb_set(v_claims, '{app_scope}',            COALESCE(v_scope, '[]'::jsonb));
  v_claims := jsonb_set(v_claims, '{must_change_password}', to_jsonb(v_user.must_change_password));
  v_claims := jsonb_set(v_claims, '{permissions_version}',  to_jsonb(v_user.permissions_version));
  v_claims := jsonb_set(v_claims, '{status}',               to_jsonb(v_user.status));

  -- Defensive: if a previous token or a future edit ever reintroduces `scope`, strip it
  -- rather than hand GoTrue something it cannot parse.
  v_claims := v_claims - 'scope';

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
