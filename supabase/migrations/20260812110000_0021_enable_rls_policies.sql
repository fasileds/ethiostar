-- 20260812110000_0021_enable_rls_policies.sql
-- phase:      1
-- module:     M09 key control — "A customer sees only their own data, enforced at the data layer"
-- ticket:     CPMS-021
-- breaking:   no
-- lock-risk:  low   (ALTER TABLE ... ENABLE ROW LEVEL SECURITY takes a brief ACCESS EXCLUSIVE)
-- rollback:   forward-fix only
--
-- ⚠️ RUN THIS BEFORE ANY REAL CUSTOMER DATA EXISTS.
-- Until it is applied, tables have grants but no policies, which means `authenticated` can
-- read across customers.
--
-- RLS is DEFENCE IN DEPTH, not the primary mechanism. The primary mechanism is the
-- application scoping every customer query explicitly. This is what saves you the day
-- someone forgets. Both, always.
--
-- AND NOTE: `service_role` bypasses ALL of this. No policy can constrain it. That is why
-- docs/adr/0013 confines it to three sanctioned uses and scripts/guard-service-role.ts
-- fails the build otherwise.

SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- Helper predicates
-- ═══════════════════════════════════════════════════════════════════════════
-- Claims come from public.custom_access_token_hook (migration 0002) and are read via
-- auth.jwt(), which resolves from request.jwt.claims — set per TRANSACTION by
-- withAuthenticatedDb(). A query outside a transaction has no claims and is evaluated as
-- anonymous: it fails closed.

CREATE OR REPLACE FUNCTION public.fn_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT coalesce(auth.jwt() ->> 'actor_kind', '') = 'staff'
     AND coalesce(auth.jwt() ->> 'status', '') = 'ACTIVE';
$$;

CREATE OR REPLACE FUNCTION public.fn_current_customer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT nullif(auth.jwt() ->> 'customer_id', '')::uuid;
$$;

-- A customer row is visible when the caller is that customer AND their account is active.
CREATE OR REPLACE FUNCTION public.fn_owns_customer(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT coalesce(auth.jwt() ->> 'actor_kind', '') = 'customer'
     AND coalesce(auth.jwt() ->> 'status', '') = 'ACTIVE'
     AND p_customer_id IS NOT NULL
     AND p_customer_id = public.fn_current_customer_id();
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Enable RLS on EVERY table in public
-- ═══════════════════════════════════════════════════════════════════════════
-- Not only the customer-scoped ones. A table with RLS disabled is readable by anyone
-- holding the anon key — which is in the browser bundle by design.
--
-- FORCE is essential: without it the table OWNER is exempt, and with Supabase's role model
-- that is a wider hole than it sounds.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      -- Partitions inherit their parent's policies; enabling on them separately is noise.
      AND tablename NOT LIKE '%\_2026\_%'
      AND tablename NOT LIKE '%\_default'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Reference and master data — readable by any active staff member
-- ═══════════════════════════════════════════════════════════════════════════
-- Customers need some of this too (coffee types and bag types appear on their own stock
-- statement), so it is readable by any authenticated active user. It contains no customer
-- data.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branch','region','woreda','coffee_type','coffee_grade','screen_size','certification',
    'harvest_year','output_classification','bag_type','bag_type_version','bag_weight_class',
    'business_type','kyc_document_type','kyc_document_requirement','reason_code_category',
    'reason_code','labour_activity_type','shift','holiday','unit_of_measure',
    'consignment_transition'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY p_%I__read ON public.%I FOR SELECT TO authenticated
         USING (coalesce(auth.jwt() ->> ''status'', '''') = ''ACTIVE'')', t, t);
    EXECUTE format(
      'CREATE POLICY p_%I__write ON public.%I FOR ALL TO authenticated
         USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff())', t, t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Identity
-- ═══════════════════════════════════════════════════════════════════════════
-- A user always sees their own profile; staff see all profiles.
CREATE POLICY p_app_user__self ON public.app_user
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.fn_is_staff());

CREATE POLICY p_app_user__staff_write ON public.app_user
  FOR ALL TO authenticated
  USING (public.fn_is_staff())
  WITH CHECK (public.fn_is_staff());

-- RBAC tables are staff-only. A customer has no business enumerating roles.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['role','permission','role_permission','user_role','user_scope'] LOOP
    EXECUTE format(
      'CREATE POLICY p_%I__staff ON public.%I FOR ALL TO authenticated
         USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff())', t, t);
  END LOOP;
END $$;

CREATE POLICY p_user_login_attempt__staff ON public.user_login_attempt
  FOR SELECT TO authenticated USING (public.fn_is_staff());
CREATE POLICY p_user_login_attempt__insert ON public.user_login_attempt
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY p_user_password_history__self ON public.user_password_history
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.fn_is_staff());
CREATE POLICY p_user_password_history__insert ON public.user_password_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- Customer-scoped operational data — THE M09 KEY CONTROL
-- ═══════════════════════════════════════════════════════════════════════════
-- Every table carrying a customer_id gets the same pair: staff see everything (their finer
-- branch/warehouse/room scoping is applied in the application, where the scope resolver
-- lives); a customer sees only their own rows, and only for SELECT.
--
-- Customers never write directly — portal submissions go through use cases that run as the
-- customer but insert via explicitly scoped statements.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'consignment','lot','stock_movement','stock_balance'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY p_%I__staff ON public.%I FOR ALL TO authenticated
         USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff())', t, t);
    EXECUTE format(
      'CREATE POLICY p_%I__customer_read ON public.%I FOR SELECT TO authenticated
         USING (public.fn_owns_customer(customer_id))', t, t);
  END LOOP;
END $$;

-- Tables reachable by a customer only THROUGH a consignment they own.
CREATE POLICY p_consignment_status_history__staff ON public.consignment_status_history
  FOR ALL TO authenticated
  USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff());

CREATE POLICY p_consignment_status_history__customer ON public.consignment_status_history
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.consignment c
    WHERE c.id = consignment_id AND public.fn_owns_customer(c.customer_id)
  ));

CREATE POLICY p_lot_status_history__staff ON public.lot_status_history
  FOR ALL TO authenticated
  USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff());

CREATE POLICY p_lot_status_history__customer ON public.lot_status_history
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lot l
    WHERE l.id = lot_id AND public.fn_owns_customer(l.customer_id)
  ));

CREATE POLICY p_lot_lineage__staff ON public.lot_lineage
  FOR ALL TO authenticated
  USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff());

CREATE POLICY p_lot_lineage__customer ON public.lot_lineage
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lot l
    WHERE l.id = child_lot_id AND public.fn_owns_customer(l.customer_id)
  ));

-- ═══════════════════════════════════════════════════════════════════════════
-- Staff-only operational tables
-- ═══════════════════════════════════════════════════════════════════════════
-- A customer has no business seeing the warehouse layout, other customers' reservations,
-- the audit log, or the job queue. "the room and section it occupies" is exposed to
-- customers "at EthioStar's discretion" via vw_stock_on_hand, not by opening these tables.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'warehouse','store_room','store_section','capacity_reservation','location_alert_threshold',
    'lot_placement','stock_transfer','stock_adjustment','stock_count','stock_count_line',
    'audit_log','domain_event','outbox','outbox_dead_letter',
    'job_queue','system_setting','system_setting_history'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY p_%I__staff ON public.%I FOR ALL TO authenticated
         USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff())', t, t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verification
-- ═══════════════════════════════════════════════════════════════════════════
-- Fail the migration if any public table ended up with RLS enabled and NO policy — that
-- table would be invisible to the application and the cause would be baffling.
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(t.tablename ORDER BY t.tablename) INTO v_missing
  FROM pg_tables t
  WHERE t.schemaname = 'public'
    AND t.tablename NOT LIKE '%\_2026\_%'
    AND t.tablename NOT LIKE '%\_default'
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.tablename
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'RLS is enabled but no policy exists on: %. Every public table needs at least one.',
      array_to_string(v_missing, ', ');
  END IF;
END $$;

COMMENT ON FUNCTION public.fn_owns_customer(uuid) IS
  'M09 key control. Reads the customer_id claim injected by custom_access_token_hook, which '
  'auth.jwt() resolves from request.jwt.claims — set per TRANSACTION by withAuthenticatedDb(). '
  'A query outside a transaction has no claims and fails closed.';
