-- 20260818070000_0033_create_application_message.sql
-- phase:      1
-- module:     M08 Customer Onboarding & Application
-- ticket:     CPMS-008
-- breaking:   no
-- lock-risk:  none   (new table only)
-- rollback:   forward-fix only
--
-- The applicant self-service reply thread: a durable, append-only log of messages between an
-- applicant (writing anonymously via the service-role public path, same as
-- `application_status_history` already does) and a reviewer, shown on both the public status
-- page and the staff review screen. Not a replacement for `application_status_history`, which
-- stays the state-machine transition log — this is free-form conversation, not tied to a
-- status change.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Table
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE "application_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"sender_kind" text NOT NULL,
	"sender_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_application_message__sender_kind" CHECK ("application_message"."sender_kind" in ('APPLICANT','STAFF'))
);

-- ═════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "application_message" ADD CONSTRAINT "application_message_application_id_customer_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."customer_application"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "application_message" ADD CONSTRAINT "application_message_sender_user_id_app_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
CREATE INDEX "idx_application_message__application" ON "application_message" USING btree ("application_id","created_at");

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
-- Append-only, same treatment as application_status_history: a reply thread is evidence of
-- what each side said and when, not something anyone edits after the fact. The BEFORE trigger
-- fires regardless of role, which matters because service_role bypasses RLS entirely.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'application_message'
  ] LOOP
    PERFORM public.fn_attach_append_only(t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- RLS
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "application_message" ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_application_message__staff ON public.application_message
  FOR ALL TO authenticated
  USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff());

CREATE POLICY p_application_message__customer_read ON public.application_message
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.customer_application a
    WHERE a.id = public.application_message.application_id
      AND a.customer_id IS NOT NULL
      AND public.fn_owns_customer(a.customer_id)
  ));
