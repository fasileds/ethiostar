-- 20260814110000_0031_phase2_workflow_contract_billing.sql
-- phase:      2
-- module:     M03 Workflow, M05 e-Signature, M10 Contracts/Tariffs, M19 Billing, M20 Storage Charging
-- ticket:     CPMS-031
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- Phase 2 build-out. Tables mirror src/db/schema/workflow.ts, contract.ts, billing.ts, and
-- the M05 additions to files.ts exactly — see those files' doc comments for the reasoning
-- behind each design choice (append-only ledgers, effective-dated tariffs, the financial
-- hold, the content-hash on signatures).

SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- M03 — Workflow & Approval Engine
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "workflow_definition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"entity_type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"steps" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version_no" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "workflow_instance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"definition_id" uuid NOT NULL REFERENCES "public"."workflow_definition"("id"),
	"definition_version" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"current_step_no" integer DEFAULT 1 NOT NULL,
	"started_by" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ck_workflow_instance__status" CHECK ("status" in ('PENDING','APPROVED','REJECTED','CANCELLED'))
);

CREATE TABLE "workflow_task" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL REFERENCES "public"."workflow_instance"("id") ON DELETE CASCADE,
	"step_no" integer NOT NULL,
	"assigned_role" text,
	"assigned_user_id" uuid,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"comment" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_workflow_task__status" CHECK ("status" in ('PENDING','APPROVED','REJECTED','RETURNED')),
	CONSTRAINT "ck_workflow_task__assignee" CHECK ("assigned_role" is not null or "assigned_user_id" is not null),
	CONSTRAINT "ck_workflow_task__decision_comment" CHECK ("status" not in ('REJECTED','RETURNED') or "comment" is not null)
);

CREATE UNIQUE INDEX "uq_workflow_definition__code_version" ON "workflow_definition" ("code", "version");
CREATE INDEX "idx_workflow_definition__entity_type" ON "workflow_definition" ("entity_type", "is_active");
CREATE INDEX "idx_workflow_instance__entity" ON "workflow_instance" ("entity_type", "entity_id");
CREATE INDEX "idx_workflow_instance__pending" ON "workflow_instance" ("current_step_no") WHERE "status" = 'PENDING';
CREATE INDEX "idx_workflow_task__instance" ON "workflow_task" ("instance_id", "step_no");
CREATE INDEX "idx_workflow_task__inbox_role" ON "workflow_task" ("assigned_role", "status");
CREATE INDEX "idx_workflow_task__inbox_user" ON "workflow_task" ("assigned_user_id", "status");

-- ═══════════════════════════════════════════════════════════════════════════
-- M10 — Contract, Tariff & Service Agreement Management
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "contract" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid NOT NULL REFERENCES "public"."customer"("id"),
	"branch_id" uuid NOT NULL REFERENCES "public"."branch"("id"),
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"free_storage_days" integer DEFAULT 0 NOT NULL,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"credit_limit_amount" numeric(14, 2),
	"currency" char(3) DEFAULT 'ETB',
	"signed_document_file_id" uuid REFERENCES "public"."stored_file"("id"),
	"terminated_at" timestamp with time zone,
	"terminated_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_contract__status" CHECK ("status" in ('DRAFT','ACTIVE','EXPIRED','TERMINATED')),
	CONSTRAINT "ck_contract__period" CHECK ("effective_to" is null or "effective_to" >= "effective_from")
);

CREATE TABLE "tariff_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid REFERENCES "public"."contract"("id") ON DELETE CASCADE,
	"branch_id" uuid NOT NULL REFERENCES "public"."branch"("id"),
	"service_code" text NOT NULL,
	"uom" text NOT NULL,
	"rate_amount" numeric(14, 2) NOT NULL,
	"currency" char(3) DEFAULT 'ETB',
	"effective_from" date NOT NULL,
	"effective_to" date,
	"negotiation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_tariff_line__uom" CHECK ("uom" in ('PER_KG','PER_KESHA','PER_DAY','FLAT')),
	CONSTRAINT "ck_tariff_line__rate" CHECK ("rate_amount" >= 0),
	CONSTRAINT "ck_tariff_line__period" CHECK ("effective_to" is null or "effective_to" >= "effective_from"),
	CONSTRAINT "ck_tariff_line__negotiation_reason" CHECK ("contract_id" is null or "negotiation_reason" is not null)
);

CREATE UNIQUE INDEX "uq_contract__reference" ON "contract" ("reference");
CREATE INDEX "idx_contract__customer" ON "contract" ("customer_id", "effective_from");
CREATE INDEX "idx_contract__status" ON "contract" ("status");
CREATE INDEX "idx_tariff_line__contract" ON "tariff_line" ("contract_id", "service_code");
CREATE INDEX "idx_tariff_line__standard" ON "tariff_line" ("branch_id", "service_code", "effective_from");

-- ═══════════════════════════════════════════════════════════════════════════
-- M19 — Billing, Invoicing & Receivables / M20 — Storage & Demurrage Charging
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "charge_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL REFERENCES "public"."customer"("id"),
	"branch_id" uuid NOT NULL REFERENCES "public"."branch"("id"),
	"contract_id" uuid REFERENCES "public"."contract"("id"),
	"service_code" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"quantity" numeric(14, 3),
	"kesha_quantity" integer,
	"uom" text NOT NULL,
	"rate_amount" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" char(3) DEFAULT 'ETB',
	"occurred_at" timestamp with time zone NOT NULL,
	"invoice_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ck_charge_event__amount" CHECK ("amount" >= 0),
	CONSTRAINT "ck_charge_event__uom" CHECK ("uom" in ('PER_KG','PER_KESHA','PER_DAY','FLAT'))
);

CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid NOT NULL REFERENCES "public"."customer"("id"),
	"branch_id" uuid NOT NULL REFERENCES "public"."branch"("id"),
	"contract_id" uuid REFERENCES "public"."contract"("id"),
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"subtotal_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'ETB',
	"notes" text,
	"voided_at" timestamp with time zone,
	"voided_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_invoice__status" CHECK ("status" in ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','OVERDUE','VOID')),
	CONSTRAINT "ck_invoice__totals" CHECK ("total_amount" = "subtotal_amount" + "tax_amount")
);

CREATE TABLE "invoice_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL REFERENCES "public"."invoice"("id") ON DELETE CASCADE,
	"charge_event_id" uuid REFERENCES "public"."charge_event"("id"),
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"service_code" text NOT NULL,
	"quantity" numeric(14, 3),
	"uom" text NOT NULL,
	"rate_amount" numeric(14, 2) NOT NULL,
	"line_amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid NOT NULL REFERENCES "public"."customer"("id"),
	"invoice_id" uuid REFERENCES "public"."invoice"("id"),
	"amount" numeric(14, 2) NOT NULL,
	"currency" char(3) DEFAULT 'ETB',
	"method" text NOT NULL,
	"external_reference" text,
	"received_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_payment__amount" CHECK ("amount" > 0),
	CONSTRAINT "ck_payment__method" CHECK ("method" in ('CASH','BANK_TRANSFER','CHEQUE','MOBILE_MONEY'))
);

CREATE TABLE "customer_credit_hold" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL REFERENCES "public"."customer"("id"),
	"reason" text NOT NULL,
	"note" text,
	"is_automatic" boolean DEFAULT false NOT NULL,
	"held_by" uuid,
	"held_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	CONSTRAINT "ck_customer_credit_hold__reason" CHECK ("reason" in ('OVERDUE_BALANCE','CREDIT_LIMIT_EXCEEDED','MANUAL'))
);

CREATE TABLE "storage_rate_tier" (
	"id" uuid PRIMARY KEY NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "public"."branch"("id"),
	"from_day" integer NOT NULL,
	"rate_per_kg_per_day" numeric(14, 2) NOT NULL,
	"currency" char(3) DEFAULT 'ETB',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_storage_rate_tier__from_day" CHECK ("from_day" >= 0),
	CONSTRAINT "ck_storage_rate_tier__rate" CHECK ("rate_per_kg_per_day" >= 0)
);

CREATE TABLE "storage_charge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lot_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL REFERENCES "public"."customer"("id"),
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"days_charged" integer NOT NULL,
	"quantity_kg" numeric(14, 3) NOT NULL,
	"rate_per_kg_per_day" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"charge_event_id" uuid REFERENCES "public"."charge_event"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ck_storage_charge__span" CHECK ("to_date" >= "from_date"),
	CONSTRAINT "ck_storage_charge__amount" CHECK ("amount" >= 0)
);

ALTER TABLE "invoice_line" ADD CONSTRAINT "uq_invoice_line__no" UNIQUE ("invoice_id", "line_no");
ALTER TABLE "invoice" ADD CONSTRAINT "uq_invoice__reference" UNIQUE ("reference");
ALTER TABLE "payment" ADD CONSTRAINT "uq_payment__reference" UNIQUE ("reference");
ALTER TABLE "storage_charge" ADD CONSTRAINT "uq_storage_charge__lot_span" UNIQUE ("lot_id", "from_date", "to_date");

CREATE INDEX "idx_charge_event__customer" ON "charge_event" ("customer_id", "occurred_at");
CREATE INDEX "idx_charge_event__source" ON "charge_event" ("source_type", "source_id");
CREATE INDEX "idx_charge_event__uninvoiced" ON "charge_event" ("customer_id", "occurred_at") WHERE "invoice_line_id" is null;
CREATE INDEX "idx_invoice__customer" ON "invoice" ("customer_id", "issue_date");
CREATE INDEX "idx_invoice__status" ON "invoice" ("status", "due_date");
CREATE INDEX "idx_invoice_line__charge_event" ON "invoice_line" ("charge_event_id");
CREATE INDEX "idx_payment__customer" ON "payment" ("customer_id", "received_at");
CREATE INDEX "idx_payment__invoice" ON "payment" ("invoice_id");
CREATE INDEX "idx_customer_credit_hold__customer" ON "customer_credit_hold" ("customer_id") WHERE "released_at" is null;
CREATE INDEX "idx_storage_rate_tier__branch" ON "storage_rate_tier" ("branch_id", "from_day");
CREATE INDEX "idx_storage_charge__lot" ON "storage_charge" ("lot_id", "to_date");
CREATE INDEX "idx_storage_charge__customer" ON "storage_charge" ("customer_id", "to_date");

ALTER TABLE "charge_event" ADD CONSTRAINT "charge_event_invoice_line_id_invoice_line_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_line"("id");

-- ═══════════════════════════════════════════════════════════════════════════
-- M05 — Document Management & e-Signature (additions to files.ts)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "document_signature" (
	"id" uuid PRIMARY KEY NOT NULL,
	"file_id" uuid NOT NULL REFERENCES "public"."stored_file"("id"),
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"signer_user_id" uuid,
	"signer_name" text NOT NULL,
	"signer_role" text,
	"method" text NOT NULL,
	"signature_data" text,
	"content_hash" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ck_document_signature__method" CHECK ("method" in ('DRAWN','TYPED','CLICK'))
);

CREATE TABLE "document_version_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_group_id" uuid NOT NULL,
	"file_id" uuid NOT NULL REFERENCES "public"."stored_file"("id"),
	"version_no" integer NOT NULL,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);

CREATE INDEX "idx_document_signature__source" ON "document_signature" ("source_type", "source_id");
CREATE INDEX "idx_document_signature__file" ON "document_signature" ("file_id");
CREATE UNIQUE INDEX "uq_document_version_history__group_version" ON "document_version_history" ("document_group_id", "version_no");
CREATE INDEX "idx_document_version_history__file" ON "document_version_history" ("file_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- Triggers, grants
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workflow_definition', 'contract', 'tariff_line',
    'invoice', 'invoice_line', 'payment', 'storage_rate_tier'
  ] LOOP
    PERFORM public.fn_attach_standard_triggers(t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workflow_instance', 'workflow_task', 'charge_event', 'customer_credit_hold',
    'storage_charge', 'document_signature', 'document_version_history'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I__set_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()',
      t, t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workflow_definition','workflow_instance','workflow_task',
    'tariff_line','customer_credit_hold','storage_rate_tier',
    'document_signature','document_version_history'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY p_%I__staff ON public.%I FOR ALL TO authenticated
         USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff())', t, t);
  END LOOP;
END $$;

-- Staff-full-access plus a narrow customer SELECT policy, on the tables a customer has a
-- direct commercial interest in (their contract, their charges, their invoices, their
-- payments, their storage charges).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contract','charge_event','invoice','payment','storage_charge'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY p_%I__staff ON public.%I FOR ALL TO authenticated
         USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff())', t, t);
    EXECUTE format(
      'CREATE POLICY p_%I__customer ON public.%I FOR SELECT TO authenticated
         USING (public.fn_owns_customer(customer_id))', t, t);
  END LOOP;
END $$;

-- invoice_line has no customer_id of its own — ownership is via its parent invoice.
ALTER TABLE "invoice_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY "p_invoice_line__staff" ON "invoice_line" FOR ALL TO authenticated
  USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff());
CREATE POLICY "p_invoice_line__customer" ON "invoice_line" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoice i
      WHERE i.id = invoice_line.invoice_id AND public.fn_owns_customer(i.customer_id)
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Verification — fail the migration if any table above has RLS on and no policy.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(c.relname) INTO v_missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    AND c.relname = ANY (ARRAY[
      'workflow_definition','workflow_instance','workflow_task',
      'contract','tariff_line','charge_event','invoice','invoice_line','payment',
      'customer_credit_hold','storage_rate_tier','storage_charge',
      'document_signature','document_version_history'
    ])
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Tables with RLS enabled but no policy: %', v_missing;
  END IF;
END $$;
