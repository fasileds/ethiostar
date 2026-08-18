-- 20260814101000_0030_printed_document_object_key.sql
-- phase:      1
-- module:     M06 Printing — direct object key on printed_document
-- ticket:     CPMS-030
-- breaking:   no
-- lock-risk:  low   (ADD COLUMN on an empty table — no real data has ever been printed)
-- rollback:   forward-fix only
--
-- WHY THIS FILE EXISTS
--
-- `/api/v1/documents/[id]/pdf` resolves a download from a `printed_document` row that the
-- requesting actor's own RLS policy (migration 0029) already proved they may see — a staff
-- member via `p_printed_document__staff`, a customer via `p_printed_document__customer`. The
-- bytes live in Supabase Storage at an object key that until now was only recoverable by
-- joining to `stored_file`, which migration 0022 deliberately kept staff-only: repeating that
-- table's ordinary upload RLS for this one download path would either force a second,
-- harder-to-express polymorphic customer policy onto `stored_file` (the exact shape 0022
-- rejected), or silently break customer downloads outright.
--
-- `object_key` is denormalised onto `printed_document` instead. It costs one text column and
-- removes the cross-table RLS problem entirely: the route needs nothing beyond the row its
-- own policy already granted.

SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE "printed_document"
  ADD COLUMN "object_key" text NOT NULL;
