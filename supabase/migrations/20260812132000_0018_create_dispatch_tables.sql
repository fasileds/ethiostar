-- 20260812132000_0018_create_dispatch_tables.sql
-- phase:      1
-- module:     M17 Dispatch, Loading & Gate-Out Control
-- ticket:     CPMS-018
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- Coffee that leaves the gate cannot be un-left, so clearance is checked at gate-out and
-- the verdict is frozen on the row.
--
-- ck_dispatch_order__dispatched_is_cleared makes that structural: nothing reaches
-- GATE_CLEARED or DISPATCHED without clearance_status = 'CLEARED'. A screen can be
-- bypassed; this cannot.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE "dispatch_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispatch_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"lot_id" uuid NOT NULL,
	"location_id" uuid,
	"bag_type_id" uuid,
	"quantity_kg" numeric(14, 3) NOT NULL,
	"kesha_count" integer NOT NULL,
	"stock_movement_id" uuid,
	"loaded_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_dispatch_line__quantity" CHECK ("dispatch_line"."quantity_kg" > 0),
	CONSTRAINT "ck_dispatch_line__kesha" CHECK ("dispatch_line"."kesha_count" > 0)
);

CREATE TABLE "dispatch_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"consignment_id" uuid,
	"release_request_id" uuid,
	"acceptance_id" uuid,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"planned_quantity_kg" numeric(14, 3) NOT NULL,
	"planned_kesha_count" integer,
	"loaded_quantity_kg" numeric(14, 3),
	"loaded_kesha_count" integer,
	"vehicle_id" uuid,
	"vehicle_plate" text,
	"trailer_plate" text,
	"driver_name" text,
	"driver_id_no" text,
	"driver_phone" text,
	"transporter_name" text,
	"destination" text,
	"clearance_status" text,
	"clearance_checked_at" timestamp with time zone,
	"clearance_checked_by" uuid,
	"clearance_note" text,
	"override_approved_by" uuid,
	"override_reason" text,
	"loading_started_at" timestamp with time zone,
	"loading_completed_at" timestamp with time zone,
	"gate_out_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"delivery_note_file_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_dispatch_order__status" CHECK ("dispatch_order"."status" in ('PLANNED','LOADING','LOADED','GATE_CLEARED','DISPATCHED','CANCELLED')),
	CONSTRAINT "ck_dispatch_order__clearance" CHECK ("dispatch_order"."clearance_status" is null or "dispatch_order"."clearance_status" in ('CLEARED','BLOCKED')),
	CONSTRAINT "ck_dispatch_order__planned" CHECK ("dispatch_order"."planned_quantity_kg" > 0),
	CONSTRAINT "ck_dispatch_order__dispatched_is_cleared" CHECK ("dispatch_order"."status" not in ('GATE_CLEARED','DISPATCHED') or "dispatch_order"."clearance_status" = 'CLEARED'),
	CONSTRAINT "ck_dispatch_order__override_named" CHECK ("dispatch_order"."override_reason" is null or "dispatch_order"."override_approved_by" is not null)
);

CREATE TABLE "dispatch_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispatch_order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid
);

CREATE TABLE "release_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"consignment_id" uuid,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"requested_quantity_kg" numeric(14, 3) NOT NULL,
	"requested_kesha_count" integer,
	"requested_collection_on" date,
	"authorised_by_contact_id" uuid,
	"authorisation_letter_file_id" uuid,
	"collector_name" text,
	"collector_id_no" text,
	"collector_phone" text,
	"vehicle_plate" text,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_release_request__status" CHECK ("release_request"."status" in ('DRAFT','SUBMITTED','APPROVED','REJECTED','DISPATCHED','CANCELLED')),
	CONSTRAINT "ck_release_request__quantity" CHECK ("release_request"."requested_quantity_kg" > 0)
);

CREATE TABLE "vehicle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plate_no" text NOT NULL,
	"vehicle_type" text,
	"capacity_kg" numeric(14, 3),
	"owner_name" text,
	"transporter_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);

-- ═════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "dispatch_line" ADD CONSTRAINT "dispatch_line_dispatch_order_id_dispatch_order_id_fk" FOREIGN KEY ("dispatch_order_id") REFERENCES "public"."dispatch_order"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "dispatch_line" ADD CONSTRAINT "dispatch_line_lot_id_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lot"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dispatch_line" ADD CONSTRAINT "dispatch_line_location_id_store_section_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."store_section"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dispatch_line" ADD CONSTRAINT "dispatch_line_bag_type_id_bag_type_id_fk" FOREIGN KEY ("bag_type_id") REFERENCES "public"."bag_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dispatch_order" ADD CONSTRAINT "dispatch_order_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dispatch_order" ADD CONSTRAINT "dispatch_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dispatch_order" ADD CONSTRAINT "dispatch_order_consignment_id_consignment_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignment"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dispatch_order" ADD CONSTRAINT "dispatch_order_release_request_id_release_request_id_fk" FOREIGN KEY ("release_request_id") REFERENCES "public"."release_request"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dispatch_order" ADD CONSTRAINT "dispatch_order_acceptance_id_acceptance_record_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptance_record"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dispatch_order" ADD CONSTRAINT "dispatch_order_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dispatch_order" ADD CONSTRAINT "dispatch_order_delivery_note_file_id_stored_file_id_fk" FOREIGN KEY ("delivery_note_file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dispatch_status_history" ADD CONSTRAINT "dispatch_status_history_dispatch_order_id_dispatch_order_id_fk" FOREIGN KEY ("dispatch_order_id") REFERENCES "public"."dispatch_order"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "release_request" ADD CONSTRAINT "release_request_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "release_request" ADD CONSTRAINT "release_request_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "release_request" ADD CONSTRAINT "release_request_consignment_id_consignment_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignment"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "release_request" ADD CONSTRAINT "release_request_authorised_by_contact_id_customer_contact_id_fk" FOREIGN KEY ("authorised_by_contact_id") REFERENCES "public"."customer_contact"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "release_request" ADD CONSTRAINT "release_request_authorisation_letter_file_id_stored_file_id_fk" FOREIGN KEY ("authorisation_letter_file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX "uq_dispatch_line__no" ON "dispatch_line" USING btree ("dispatch_order_id","line_no");
CREATE INDEX "idx_dispatch_line__order" ON "dispatch_line" USING btree ("dispatch_order_id");
CREATE INDEX "idx_dispatch_line__lot" ON "dispatch_line" USING btree ("lot_id");
CREATE UNIQUE INDEX "uq_dispatch_order__reference" ON "dispatch_order" USING btree ("reference");
CREATE INDEX "idx_dispatch_order__customer" ON "dispatch_order" USING btree ("customer_id","created_at");
CREATE INDEX "idx_dispatch_order__consignment" ON "dispatch_order" USING btree ("consignment_id");
CREATE INDEX "idx_dispatch_order__status" ON "dispatch_order" USING btree ("status");
CREATE INDEX "idx_dispatch_order__release" ON "dispatch_order" USING btree ("release_request_id");
CREATE INDEX "idx_dispatch_order__gate_queue" ON "dispatch_order" USING btree ("loading_completed_at") WHERE "dispatch_order"."status" in ('LOADED','GATE_CLEARED');
CREATE INDEX "idx_dispatch_status_history__order" ON "dispatch_status_history" USING btree ("dispatch_order_id","changed_at");
CREATE UNIQUE INDEX "uq_release_request__reference" ON "release_request" USING btree ("reference");
CREATE INDEX "idx_release_request__customer" ON "release_request" USING btree ("customer_id","created_at");
CREATE INDEX "idx_release_request__consignment" ON "release_request" USING btree ("consignment_id");
CREATE INDEX "idx_release_request__status" ON "release_request" USING btree ("status");
CREATE INDEX "idx_release_request__pending" ON "release_request" USING btree ("requested_collection_on") WHERE "release_request"."status" = 'SUBMITTED';
CREATE UNIQUE INDEX "uq_vehicle__plate" ON "vehicle" USING btree ("plate_no");

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vehicle','release_request','dispatch_order','dispatch_line'
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
    'dispatch_status_history'
  ] LOOP
    PERFORM public.fn_attach_append_only(t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
  END LOOP;
END $$;
