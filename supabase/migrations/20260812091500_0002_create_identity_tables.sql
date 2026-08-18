-- 20260812091500_0002_create_identity_tables.sql
-- phase:      1
-- module:     M01 Identity, Access & Role Management
-- ticket:     CPMS-002
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- app_user — the DOMAIN half of identity
-- ═══════════════════════════════════════════════════════════════════════════
-- GoTrue owns auth.users, auth.sessions, auth.mfa_factors and invitations. We never add
-- columns to auth.users — it is Supabase-owned and upgraded underneath us. This table
-- carries everything domain-specific, keyed 1:1 to the auth user.
CREATE TABLE public.app_user (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_kind          text        NOT NULL,
  customer_id         uuid,
  email               text        NOT NULL,
  full_name           text        NOT NULL,
  phone               text,
  employee_number     text,
  job_title           text,
  status              text        NOT NULL DEFAULT 'ACTIVE',
  must_change_password boolean    NOT NULL DEFAULT false,
  permissions_version integer     NOT NULL DEFAULT 1,
  mfa_required        boolean     NOT NULL DEFAULT false,
  last_seen_at        timestamptz,
  suspended_at        timestamptz,
  suspended_reason    text,
  preferred_locale    text        NOT NULL DEFAULT 'en',
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  version             integer     NOT NULL DEFAULT 0,

  CONSTRAINT ck_app_user__actor_kind CHECK (actor_kind IN ('staff','customer')),
  CONSTRAINT ck_app_user__status     CHECK (status IN ('ACTIVE','SUSPENDED','LOCKED','DORMANT')),
  CONSTRAINT ck_app_user__locale     CHECK (preferred_locale IN ('en','am')),
  -- A customer user is bound to a customer; a staff user must not be.
  CONSTRAINT ck_app_user__customer_binding CHECK (
    (actor_kind = 'customer' AND customer_id IS NOT NULL) OR
    (actor_kind = 'staff'    AND customer_id IS NULL)
  )
);

CREATE UNIQUE INDEX uq_app_user__email        ON public.app_user (email);
CREATE        INDEX idx_app_user__customer    ON public.app_user (customer_id) WHERE customer_id IS NOT NULL;
CREATE        INDEX idx_app_user__status      ON public.app_user (status);
CREATE        INDEX idx_app_user__last_seen   ON public.app_user (last_seen_at);

COMMENT ON COLUMN public.app_user.status IS
  'Re-read by requireActor() on EVERY request. This is what makes revocation effectively '
  'immediate despite a self-contained JWT with a 5-minute lifetime.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Password history and login attempts
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.user_password_history (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  changed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_password_history__user ON public.user_password_history (user_id, changed_at DESC);

CREATE TABLE public.user_login_attempt (
  id             uuid PRIMARY KEY,
  user_id        uuid REFERENCES public.app_user(id) ON DELETE SET NULL,
  email          text NOT NULL,
  succeeded      boolean NOT NULL,
  failure_reason text,
  ip_address     text,
  user_agent     text,
  attempted_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_login_attempt__email    ON public.user_login_attempt (email, attempted_at DESC);
CREATE INDEX idx_user_login_attempt__user     ON public.user_login_attempt (user_id, attempted_at DESC);
CREATE INDEX idx_user_login_attempt__failures ON public.user_login_attempt (email, attempted_at DESC)
  WHERE succeeded = false;

-- ═══════════════════════════════════════════════════════════════════════════
-- RBAC
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.permission (
  id           uuid PRIMARY KEY,
  code         text NOT NULL,
  resource     text NOT NULL,
  action       text NOT NULL,
  description  text NOT NULL,
  group_code   text NOT NULL,
  is_read_only boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  version      integer NOT NULL DEFAULT 0,

  CONSTRAINT ck_permission__code_shape CHECK (code ~ '^[a-z_]+:[a-z_]+$')
);
CREATE UNIQUE INDEX uq_permission__code  ON public.permission (code);
CREATE        INDEX idx_permission__group ON public.permission (group_code);

COMMENT ON TABLE public.permission IS
  'The CATALOGUE is code-owned (db/seeds/010-permissions.ts) and synced on every deploy, so '
  'a permission can never be missing in production. The role MAPPING below is '
  'administrator-editable (M23).';

CREATE TABLE public.role (
  id           uuid PRIMARY KEY,
  code         text NOT NULL,
  name_en      text NOT NULL,
  name_am      text,
  description  text,
  is_system    boolean NOT NULL DEFAULT false,
  requires_mfa boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  version      integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_role__code ON public.role (code);

CREATE TABLE public.role_permission (
  role_id       uuid NOT NULL REFERENCES public.role(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permission(id) ON DELETE CASCADE,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  granted_by    uuid,
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_role_permission__permission ON public.role_permission (permission_id);

CREATE TABLE public.user_role (
  user_id     uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES public.role(id)     ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid NOT NULL,
  expires_at  timestamptz,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_role__role      ON public.user_role (role_id);
CREATE INDEX idx_user_role__expiring  ON public.user_role (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE public.user_scope (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  scope_kind text NOT NULL,
  scope_id   uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,

  CONSTRAINT ck_user_scope__kind CHECK (scope_kind IN ('global','branch','warehouse','room')),
  CONSTRAINT ck_user_scope__target CHECK (
    (scope_kind =  'global' AND scope_id IS NULL) OR
    (scope_kind <> 'global' AND scope_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_user_scope__user_kind_target ON public.user_scope (user_id, scope_kind, scope_id);
CREATE        INDEX idx_user_scope__user            ON public.user_scope (user_id);

COMMENT ON TABLE public.user_scope IS
  'M01: "a store keeper of Room A cannot post movements in Room B." Effective scope is the '
  'union of a user''s rows. Absence of a row is NOT permission — deny by default.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Standard triggers
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.fn_attach_standard_triggers('app_user');
SELECT public.fn_attach_standard_triggers('permission');
SELECT public.fn_attach_standard_triggers('role');
SELECT public.fn_attach_standard_triggers('user_scope');

-- user_login_attempt and user_password_history are append-only evidence.
SELECT public.fn_attach_append_only('user_login_attempt');
SELECT public.fn_attach_append_only('user_password_history');

-- role_permission / user_role are association tables: audit them, but they have no
-- updated_at to maintain.
CREATE TRIGGER trg_role_permission__audit
  AFTER INSERT OR UPDATE OR DELETE ON public.role_permission
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_row();
CREATE TRIGGER trg_user_role__audit
  AFTER INSERT OR UPDATE OR DELETE ON public.user_role
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_row();

-- ═══════════════════════════════════════════════════════════════════════════
-- Auto-provision the profile when GoTrue creates a user
-- ═══════════════════════════════════════════════════════════════════════════
-- auth.admin.inviteUserByEmail() passes actor_kind / customer_id / full_name in
-- raw_user_meta_data. Creating the profile in a trigger rather than a second round-trip
-- means a GoTrue user can never exist without its domain profile.
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

CREATE TRIGGER trg_auth_users__create_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_auth_user();

-- ═══════════════════════════════════════════════════════════════════════════
-- custom_access_token_hook — RBAC claims into the JWT
-- ═══════════════════════════════════════════════════════════════════════════
-- Runs before every token issue and refresh.
--
-- IMPORTANT: these claims are for RLS SCOPING and OPTIMISTIC UI ONLY. Authorization
-- decisions are made in the use case against the database, because a claim can be up to
-- one token lifetime stale. `permissions_version` lets the DAL detect a stale token.
-- See docs/adr/0011-authorization-model.md and docs/adr/0014-supabase-auth.md.
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
  v_claims := jsonb_set(v_claims, '{scope}',                COALESCE(v_scope, '[]'::jsonb));
  v_claims := jsonb_set(v_claims, '{must_change_password}', to_jsonb(v_user.must_change_password));
  v_claims := jsonb_set(v_claims, '{permissions_version}',  to_jsonb(v_user.permissions_version));
  v_claims := jsonb_set(v_claims, '{status}',               to_jsonb(v_user.status));

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

-- Only GoTrue may execute the hook.
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;

-- The hook reads these tables as supabase_auth_admin.
GRANT USAGE  ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON public.app_user, public.user_role, public.role, public.user_scope
  TO supabase_auth_admin;

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants
-- ═══════════════════════════════════════════════════════════════════════════
-- Reads go through `authenticated`; writes go through use cases that run in the same role.
-- RLS policies (migration 0021) decide which ROWS are visible. `anon` gets nothing.
GRANT SELECT ON public.app_user, public.role, public.permission,
                public.role_permission, public.user_role, public.user_scope
  TO authenticated;

GRANT INSERT, UPDATE ON public.app_user   TO authenticated;
GRANT INSERT, DELETE ON public.user_role  TO authenticated;
GRANT INSERT, DELETE ON public.role_permission TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_scope TO authenticated;
GRANT INSERT ON public.user_login_attempt, public.user_password_history TO authenticated;
