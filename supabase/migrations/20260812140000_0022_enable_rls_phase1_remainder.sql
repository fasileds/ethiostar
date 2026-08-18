-- 20260812140000_0022_enable_rls_phase1_remainder.sql
-- phase:      1
-- module:     M09 key control, extended to the tables created by 0006–0020
-- ticket:     CPMS-022
-- breaking:   no
-- lock-risk:  low   (ALTER TABLE ... ENABLE ROW LEVEL SECURITY takes a brief ACCESS EXCLUSIVE)
-- rollback:   forward-fix only
--
-- 0021 secured the tables that existed when it ran. Everything created by 0006–0020 came
-- afterwards and therefore has grants but NO policies and NO row-level security. Until this
-- migration is applied, `authenticated` can read every customer's applications, receipts and
-- acceptances.
--
-- ⚠️ THIS MUST BE APPLIED IN THE SAME DEPLOYMENT AS 0006–0020, never later.
--
-- Same shape as 0021: RLS is defence in depth, not the primary mechanism — the application
-- scopes every customer query explicitly. This is what saves you the day someone forgets.
-- And as always, `service_role` bypasses all of it; that is why it is confined to three
-- sanctioned uses and scripts/guard-service-role.ts fails the build otherwise.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- Enable RLS on every new table
-- ═══════════════════════════════════════════════════════════════════════════
-- Re-runs the same sweep 0021 used. ENABLE is idempotent, so tables already secured are
-- untouched and any table added between then and now is caught.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '%\_2026\_%'
      AND tablename NOT LIKE '%\_default'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Customer-scoped tables carrying customer_id directly — THE M09 KEY CONTROL
-- ═══════════════════════════════════════════════════════════════════════════
-- Staff see everything (finer branch/warehouse scoping is applied in the application, where
-- the scope resolver lives); a customer sees only their own rows, and only for SELECT.
--
-- Customers never write directly. Portal submissions go through use cases that run as the
-- customer and insert via explicitly scoped statements.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'delivery_request','goods_receipt',
    'appointment',
    'processing_request','job_order',
    'acceptance_record',
    'release_request','dispatch_order',
    'kesha_movement','kesha_balance','kesha_reconciliation'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY p_%I__staff ON public.%I FOR ALL TO authenticated
         USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff())', t, t);
    EXECUTE format(
      'CREATE POLICY p_%I__customer_read ON public.%I FOR SELECT TO authenticated
         USING (public.fn_owns_customer(customer_id))', t, t);
  END LOOP;
END $$;

-- `customer` is kept out of that loop deliberately: it keys on its own id, not on a
-- customer_id column, so the generated policy would not even compile.
CREATE POLICY p_customer__staff ON public.customer
  FOR ALL TO authenticated
  USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff());

CREATE POLICY p_customer__self_read ON public.customer
  FOR SELECT TO authenticated
  USING (public.fn_owns_customer(id));

-- ═══════════════════════════════════════════════════════════════════════════
-- Tables reachable by a customer only THROUGH a parent they own
-- ═══════════════════════════════════════════════════════════════════════════
-- Each gets a staff ALL policy plus a customer SELECT policy that walks one join to the
-- owning record. One level only — deeper chains are resolved in the application, because a
-- policy nobody can read is a policy nobody can review.
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- child table,                        parent table,           child fk,       parent customer col
      ('customer_contact',                   'customer',             'customer_id',  'id'),
      ('customer_address',                   'customer',             'customer_id',  'id'),
      ('customer_bank_account',              'customer',             'customer_id',  'id'),
      ('customer_status_history',            'customer',             'customer_id',  'id'),
      ('delivery_request_status_history',    'delivery_request',     'delivery_request_id', 'customer_id'),
      ('goods_receipt_line',                 'goods_receipt',        'receipt_id',   'customer_id'),
      ('appointment_status_history',         'appointment',          'appointment_id','customer_id'),
      ('job_order_input',                    'job_order',            'job_order_id', 'customer_id'),
      ('job_order_output',                   'job_order',            'job_order_id', 'customer_id'),
      ('job_order_status_history',           'job_order',            'job_order_id', 'customer_id'),
      ('acceptance_line',                    'acceptance_record',    'acceptance_id','customer_id'),
      ('acceptance_status_history',          'acceptance_record',    'acceptance_id','customer_id'),
      ('dispatch_line',                      'dispatch_order',       'dispatch_order_id','customer_id'),
      ('dispatch_status_history',            'dispatch_order',       'dispatch_order_id','customer_id')
    ) AS s(child, parent, fk, owner_col)
  LOOP
    EXECUTE format(
      'CREATE POLICY p_%I__staff ON public.%I FOR ALL TO authenticated
         USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff())',
      spec.child, spec.child);

    EXECUTE format(
      'CREATE POLICY p_%I__customer_read ON public.%I FOR SELECT TO authenticated
         USING (EXISTS (
           SELECT 1 FROM public.%I p
           WHERE p.id = public.%I.%I
             AND public.fn_owns_customer(p.%I)
         ))',
      spec.child, spec.child, spec.parent, spec.child, spec.fk, spec.owner_col);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Applications — the one table an applicant reads BEFORE they are a customer
-- ═══════════════════════════════════════════════════════════════════════════
-- A public applicant is anonymous: they have no JWT, no customer_id and no user row, so no
-- policy can identify them. Status lookup by reference therefore goes through a rate-limited
-- route handler that reads with an explicitly scoped statement — NOT through a table grant
-- to `anon`, which would expose every applicant's TIN and licence to anyone with the anon key
-- (which ships in the browser bundle by design).
--
-- Once approved, the resulting customer can read the application they came from.
CREATE POLICY p_customer_application__staff ON public.customer_application
  FOR ALL TO authenticated
  USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff());

CREATE POLICY p_customer_application__customer_read ON public.customer_application
  FOR SELECT TO authenticated
  USING (customer_id IS NOT NULL AND public.fn_owns_customer(customer_id));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['application_document','application_status_history'] LOOP
    EXECUTE format(
      'CREATE POLICY p_%I__staff ON public.%I FOR ALL TO authenticated
         USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff())', t, t);
    EXECUTE format(
      'CREATE POLICY p_%I__customer_read ON public.%I FOR SELECT TO authenticated
         USING (EXISTS (
           SELECT 1 FROM public.customer_application a
           WHERE a.id = public.%I.application_id
             AND a.customer_id IS NOT NULL
             AND public.fn_owns_customer(a.customer_id)
         ))', t, t, t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Notifications — scoped to the recipient, not to staff
-- ═══════════════════════════════════════════════════════════════════════════
CREATE POLICY p_notification__staff ON public.notification
  FOR ALL TO authenticated
  USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff());

CREATE POLICY p_notification__recipient_read ON public.notification
  FOR SELECT TO authenticated
  USING (
    recipient_user_id = auth.uid()
    OR (recipient_customer_id IS NOT NULL AND public.fn_owns_customer(recipient_customer_id))
  );

-- A recipient marks their own notification read; that is the only column they change, and
-- the application restricts the statement to it.
CREATE POLICY p_notification__recipient_update ON public.notification
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

CREATE POLICY p_notification_preference__staff ON public.notification_preference
  FOR ALL TO authenticated
  USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff());

CREATE POLICY p_notification_preference__self ON public.notification_preference
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR (customer_id IS NOT NULL AND public.fn_owns_customer(customer_id))
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (customer_id IS NOT NULL AND public.fn_owns_customer(customer_id))
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Staff-only tables
-- ═══════════════════════════════════════════════════════════════════════════
-- A customer has no business reading the machine list, another customer's gate events, the
-- labour roster, or the file access log.
--
-- stored_file is deliberately in here. A customer's access to their own documents is granted
-- as a SIGNED URL minted per request, after the same authorisation check the owning record
-- uses — an object key is not a permission, and a polymorphic source_type/source_id policy
-- would be both unreadable and only as correct as its longest branch.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stored_file','file_access_log',
    'gate_pass','weighbridge_ticket','quality_inspection','gate_event',
    'machine','machine_capacity_day','schedule_delay',
    'job_production_log',
    'vehicle',
    'labour_worker','labour_crew','labour_crew_member','labour_rate',
    'labour_attendance','labour_output','labour_payroll_period',
    'notification_template','document_template','printed_document','document_verification'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY p_%I__staff ON public.%I FOR ALL TO authenticated
         USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff())', t, t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verification
-- ═══════════════════════════════════════════════════════════════════════════
-- Same guard as 0021: fail the migration if any public table has RLS on and no policy. Such
-- a table is invisible to the application and the cause is baffling to diagnose.
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

COMMENT ON POLICY p_customer_application__customer_read ON public.customer_application IS
  'An approved applicant can read the application they came from. A PENDING applicant is '
  'anonymous and reads status through a rate-limited route handler, never a table grant.';
