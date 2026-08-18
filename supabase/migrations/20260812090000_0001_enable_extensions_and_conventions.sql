-- 20260812090000_0001_enable_extensions_and_conventions.sql
-- phase:      1
-- module:     foundation
-- ticket:     CPMS-001
-- breaking:   no
-- lock-risk:  none   (new objects only; no existing tables)
-- rollback:   forward-fix only — these are additive definitions

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- Extensions
-- ═══════════════════════════════════════════════════════════════════════════
-- btree_gist is load-bearing: the appointment-overlap constraint (M14) and every
-- effective-dated master-data table (M02) depend on EXCLUDE ... USING gist.
CREATE EXTENSION IF NOT EXISTS pgcrypto   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext     WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm    WITH SCHEMA extensions;

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_set_updated_at — maintains updated_at on every business table
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_set_updated_at() IS
  'Maintains updated_at. Attach BEFORE UPDATE to every table carrying auditColumns().';

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_block_mutation — append-only enforcement
-- ═══════════════════════════════════════════════════════════════════════════
-- M07 key control: "Audit records cannot be edited or deleted by any role."
--
-- This matters MORE under Supabase than it would elsewhere. service_role bypasses RLS,
-- so a policy alone would not stop a privileged path from rewriting history. A BEFORE
-- trigger fires regardless of role, and the REVOKE below covers service_role explicitly.
-- Belt and braces, deliberately.
CREATE OR REPLACE FUNCTION public.fn_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'Table %.% is append-only; % is not permitted',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Correct the record by inserting a new row that supersedes it.';
END;
$$;

COMMENT ON FUNCTION public.fn_block_mutation() IS
  'Rejects UPDATE/DELETE. Attach to audit_log, domain_event, stock_movement, notification, '
  'printed_document, *_status_history and gate_event.';

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_current_actor_id — who is acting, on either connection path
-- ═══════════════════════════════════════════════════════════════════════════
-- auth.uid() on the authenticated path; app.actor_id on the worker's service-role path.
-- Raises when neither is set, which is what makes an un-attributed write IMPOSSIBLE
-- rather than merely discouraged.
--
-- M01 key control: "Every action in the system is attributable to a named user;
-- no shared or generic operational accounts are permitted."
CREATE OR REPLACE FUNCTION public.fn_current_actor_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_actor text;
BEGIN
  -- auth.uid() reads request.jwt.claims, which withAuthenticatedDb() sets per transaction.
  BEGIN
    v_actor := nullif(current_setting('request.jwt.claim.sub', true), '');
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF v_actor IS NULL THEN
    v_actor := nullif(current_setting('app.actor_id', true), '');
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'No acting user in context: every write must be attributable to a named user'
      USING ERRCODE = 'raise_exception',
            HINT = 'Use withAuthenticatedDb() or withServiceDb() — never a bare connection.';
  END IF;

  RETURN v_actor::uuid;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_audit_row — generic before/after capture
-- ═══════════════════════════════════════════════════════════════════════════
-- Catches everything, including changes made by a path someone forgot to instrument.
-- The typed domain_event stream is the semantic record; this is the safety net.
--
-- Writes only the CHANGED fields on UPDATE, so the diff is readable months later
-- ("a weight correction shows exactly what it was and what it became").
CREATE OR REPLACE FUNCTION public.fn_audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old        jsonb;
  v_new        jsonb;
  v_changed    jsonb := '{}'::jsonb;
  v_key        text;
  v_entity_id  uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_entity_id := (v_old ->> 'id')::uuid;
  ELSIF TG_OP = 'INSERT' THEN
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_entity_id := (v_new ->> 'id')::uuid;
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_entity_id := (v_new ->> 'id')::uuid;

    -- Only the fields that actually changed.
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
        v_changed := v_changed || jsonb_build_object(
          v_key,
          jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key)
        );
      END IF;
    END LOOP;

    -- A no-op UPDATE (only updated_at moved) is noise, not evidence.
    IF v_changed - 'updated_at' - 'updated_by' - 'version' = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.audit_log (
    id, entity_type, entity_id, operation,
    changed_fields, old_values, new_values,
    actor_id, occurred_at, request_id, ip_address, user_agent
  ) VALUES (
    extensions.gen_random_uuid(),
    TG_TABLE_NAME,
    v_entity_id,
    TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN v_changed ELSE NULL END,
    v_old,
    v_new,
    public.fn_current_actor_id(),
    now(),
    nullif(current_setting('app.request_id', true), ''),
    nullif(current_setting('app.ip_address', true), ''),
    nullif(current_setting('app.user_agent', true), '')
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.fn_audit_row() IS
  'Row-level audit capture with before/after values. SECURITY DEFINER so it can insert '
  'into the append-only audit_log, which no application role may write to directly.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Helper: attach the standard triggers to a table
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_attach_standard_triggers(p_table text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER trg_%I__set_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()',
    p_table, p_table
  );
  EXECUTE format(
    'CREATE TRIGGER trg_%I__audit AFTER INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.fn_audit_row()',
    p_table, p_table
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_attach_append_only(p_table text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER trg_%I__append_only BEFORE UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.fn_block_mutation()',
    p_table, p_table
  );
  -- The trigger is the real control; the REVOKE removes the temptation.
  EXECUTE format(
    'REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated, anon, service_role',
    p_table
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Default privileges
-- ═══════════════════════════════════════════════════════════════════════════
-- Deny by default. Each migration grants exactly what its tables need.
-- `anon` gets nothing at all: the only unauthenticated write is the public application
-- form, which goes through a rate-limited route handler, not a direct table grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

REVOKE ALL ON SCHEMA public FROM anon;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
