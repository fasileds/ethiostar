-- 20260812122000_0008_create_onboarding_tables.sql
-- phase:      1
-- module:     M08 Customer Onboarding & Application
-- ticket:     CPMS-008
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- Closes the customer ⇄ application cycle left open by 0007.
--
-- ck_customer_application__approved_has_customer is the invariant that makes the
-- M07/M08 link trustworthy: an APPROVED application must name the customer it produced.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE "application_document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"document_type_id" uuid NOT NULL,
	"file_id" uuid,
	"document_number" text,
	"issued_on" date,
	"expires_on" date,
	"verification_status" text DEFAULT 'PENDING' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_application_document__verification" CHECK ("application_document"."verification_status" in ('PENDING','VERIFIED','REJECTED'))
);

CREATE TABLE "application_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"by_applicant" boolean DEFAULT false NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid
);

CREATE TABLE "customer_application" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"legal_name_am" text,
	"business_type_id" uuid,
	"tin" text,
	"business_licence_no" text,
	"licence_expires_on" date,
	"ecx_membership_no" text,
	"region_id" uuid,
	"woreda_id" uuid,
	"city" text,
	"contact_name" text NOT NULL,
	"contact_position" text,
	"contact_phone" text NOT NULL,
	"contact_email" text NOT NULL,
	"expected_annual_volume_kg" numeric(14, 3),
	"expected_kesha_per_season" integer,
	"primary_coffee_type_id" uuid,
	"intended_services" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp with time zone,
	"review_started_at" timestamp with time zone,
	"reviewed_by" uuid,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_note" text,
	"rejection_reason" text,
	"info_requested" text,
	"customer_id" uuid,
	"submitted_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_customer_application__status" CHECK ("customer_application"."status" in ('DRAFT','SUBMITTED','UNDER_REVIEW','INFO_REQUESTED','APPROVED','REJECTED','WITHDRAWN')),
	CONSTRAINT "ck_customer_application__approved_has_customer" CHECK ("customer_application"."status" <> 'APPROVED' or "customer_application"."customer_id" is not null)
);

-- ═════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "application_document" ADD CONSTRAINT "application_document_application_id_customer_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."customer_application"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "application_document" ADD CONSTRAINT "application_document_document_type_id_kyc_document_type_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."kyc_document_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "application_document" ADD CONSTRAINT "application_document_file_id_stored_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_customer_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."customer_application"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "customer_application" ADD CONSTRAINT "customer_application_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer_application" ADD CONSTRAINT "customer_application_business_type_id_business_type_id_fk" FOREIGN KEY ("business_type_id") REFERENCES "public"."business_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer_application" ADD CONSTRAINT "customer_application_region_id_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."region"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer_application" ADD CONSTRAINT "customer_application_woreda_id_woreda_id_fk" FOREIGN KEY ("woreda_id") REFERENCES "public"."woreda"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer_application" ADD CONSTRAINT "customer_application_primary_coffee_type_id_coffee_type_id_fk" FOREIGN KEY ("primary_coffee_type_id") REFERENCES "public"."coffee_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer_application" ADD CONSTRAINT "customer_application_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "customer" ADD CONSTRAINT "customer_application_id_customer_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."customer_application"("id") ON DELETE no action ON UPDATE no action;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
CREATE INDEX "idx_application_document__application" ON "application_document" USING btree ("application_id");
CREATE UNIQUE INDEX "uq_application_document__type" ON "application_document" USING btree ("application_id","document_type_id");
CREATE INDEX "idx_application_status_history__application" ON "application_status_history" USING btree ("application_id","changed_at");
CREATE UNIQUE INDEX "uq_customer_application__reference" ON "customer_application" USING btree ("reference");
CREATE INDEX "idx_customer_application__status" ON "customer_application" USING btree ("status","created_at");
CREATE INDEX "idx_customer_application__branch" ON "customer_application" USING btree ("branch_id");
CREATE INDEX "idx_customer_application__customer" ON "customer_application" USING btree ("customer_id");
CREATE INDEX "idx_customer_application__contact_email" ON "customer_application" USING btree ("contact_email");

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customer_application','application_document'
  ] LOOP
    PERFORM public.fn_attach_standard_triggers(t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Append-only: history, ledgers and logs. The BEFORE trigger fires regardless of
-- role, which matters because service_role bypasses RLS entirely — a policy alone
-- would not stop a privileged path from rewriting history.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'application_status_history'
  ] LOOP
    PERFORM public.fn_attach_append_only(t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
  END LOOP;
END $$;
