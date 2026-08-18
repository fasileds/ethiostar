-- 20260812121000_0007_create_customer_tables.sql
-- phase:      1
-- module:     M07 Customer Master
-- ticket:     CPMS-007
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- customer.application_id has no FK yet — customer_application does not exist until
-- 0008, which adds it. Splitting the cycle this way keeps each migration runnable on
-- its own.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
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
	"primary_phone" text,
	"primary_email" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"suspended_reason" text,
	"suspended_at" timestamp with time zone,
	"application_id" uuid,
	"onboarded_on" date,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_customer__status" CHECK ("customer"."status" in ('ACTIVE','SUSPENDED','CLOSED'))
);

CREATE TABLE "customer_address" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"address_type" text DEFAULT 'HEAD_OFFICE' NOT NULL,
	"region_id" uuid,
	"woreda_id" uuid,
	"city" text,
	"sub_city" text,
	"kebele" text,
	"house_no" text,
	"po_box" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_customer_address__type" CHECK ("customer_address"."address_type" in ('HEAD_OFFICE','SITE','BILLING'))
);

CREATE TABLE "customer_bank_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"bank_name" text NOT NULL,
	"branch_name" text,
	"account_name" text NOT NULL,
	"account_number" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "customer_contact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"position" text,
	"phone" text,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"can_authorise_release" boolean DEFAULT false NOT NULL,
	"id_document_type" text,
	"id_document_no" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "customer_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid
);

-- ═════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "customer" ADD CONSTRAINT "customer_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer" ADD CONSTRAINT "customer_business_type_id_business_type_id_fk" FOREIGN KEY ("business_type_id") REFERENCES "public"."business_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer" ADD CONSTRAINT "customer_region_id_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."region"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer" ADD CONSTRAINT "customer_woreda_id_woreda_id_fk" FOREIGN KEY ("woreda_id") REFERENCES "public"."woreda"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_region_id_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."region"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_woreda_id_woreda_id_fk" FOREIGN KEY ("woreda_id") REFERENCES "public"."woreda"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer_bank_account" ADD CONSTRAINT "customer_bank_account_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "customer_contact" ADD CONSTRAINT "customer_contact_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "customer_status_history" ADD CONSTRAINT "customer_status_history_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX "uq_customer__code" ON "customer" USING btree ("code");
CREATE UNIQUE INDEX "uq_customer__tin" ON "customer" USING btree ("tin") WHERE "customer"."tin" is not null;
CREATE INDEX "idx_customer__branch" ON "customer" USING btree ("branch_id");
CREATE INDEX "idx_customer__status" ON "customer" USING btree ("status");
CREATE INDEX "idx_customer__legal_name" ON "customer" USING btree ("legal_name");
CREATE INDEX "idx_customer_address__customer" ON "customer_address" USING btree ("customer_id");
CREATE INDEX "idx_customer_bank_account__customer" ON "customer_bank_account" USING btree ("customer_id");
CREATE UNIQUE INDEX "uq_customer_bank_account__primary" ON "customer_bank_account" USING btree ("customer_id") WHERE "customer_bank_account"."is_primary" and "customer_bank_account"."is_active";
CREATE INDEX "idx_customer_contact__customer" ON "customer_contact" USING btree ("customer_id");
CREATE UNIQUE INDEX "uq_customer_contact__primary" ON "customer_contact" USING btree ("customer_id") WHERE "customer_contact"."is_primary" and "customer_contact"."is_active";
CREATE INDEX "idx_customer_status_history__customer" ON "customer_status_history" USING btree ("customer_id","changed_at");

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customer','customer_contact','customer_address','customer_bank_account'
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
    'customer_status_history'
  ] LOOP
    PERFORM public.fn_attach_append_only(t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
  END LOOP;
END $$;
