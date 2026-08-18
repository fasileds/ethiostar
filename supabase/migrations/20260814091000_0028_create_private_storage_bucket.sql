-- 20260814091000_0028_create_private_storage_bucket.sql
-- phase:      1
-- module:     M05 seam — file storage
-- ticket:     CPMS-028
-- breaking:   no
-- lock-risk:  none
-- rollback:   forward-fix only
--
-- WHY THIS FILE EXISTS
--
-- `stored_file` holds the metadata; the bytes live in Supabase Storage. Roadmap Step 10's
-- definition of done includes "the bucket is private and a raw object URL without a
-- signature returns 400/403" — which requires the bucket to exist and be private, and
-- requires `authenticated` to hold NO grants on storage.objects.
--
-- THE AUTHORISATION MODEL, STATED EXPLICITLY
--
-- Access is decided by the APPLICATION against the OWNING RECORD, under RLS, and only then
-- is a short-lived signed URL minted. Storage policies deliberately do NOT try to reproduce
-- that decision: whether a user may read a given object depends on whether they may read the
-- customer application, consignment or acceptance it hangs off, and expressing those joins a
-- second time in `storage.objects` policies would mean the same rule in two languages,
-- drifting apart on the first change.
--
-- The safety of that trade rests entirely on this migration: with the bucket private and
-- `authenticated` granted nothing, there is no path to an object except through the
-- application's check. If a later migration grants `authenticated` access to
-- storage.objects, the confinement in scripts/guard-service-role.ts becomes decorative.
--
-- docs/adr/0013-supabase-as-database-platform.md

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- The bucket
-- ═════════════════════════════════════════════════════════════════════════
-- `public = false` is the load-bearing column: a public bucket serves every object over an
-- unauthenticated, guessable URL, which would expose every customer's trade licence and
-- bank details to anyone who could construct a key.
--
-- The name must match SUPABASE_STORAGE_BUCKET (default `cpms-documents`). Hardcoded here
-- because a migration cannot read application environment variables; a deployment using a
-- different bucket name must add its own migration rather than silently running without one.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cpms-documents',
  'cpms-documents',
  false,
  10485760,  -- 10 MB, matching UPLOAD_MAX_BYTES
  ARRAY['application/pdf','image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ═════════════════════════════════════════════════════════════════════════
-- Policies
-- ═════════════════════════════════════════════════════════════════════════
-- storage.objects has RLS enabled by Supabase. We add NO policy for `authenticated` or
-- `anon` on this bucket, which — with RLS on and no policy — denies them everything.
--
-- service_role bypasses RLS and is therefore unaffected; that is the single path in, and it
-- is confined to src/platform/storage/supabase-file-storage.ts by the CI guard.
--
-- The DROP statements make the migration re-runnable and, more importantly, remove any
-- permissive policy a previous manual dashboard change may have left behind.
DO $$
BEGIN
  DROP POLICY IF EXISTS "cpms_documents_authenticated_select" ON storage.objects;
  DROP POLICY IF EXISTS "cpms_documents_authenticated_insert" ON storage.objects;
  DROP POLICY IF EXISTS "cpms_documents_anon_select"          ON storage.objects;
END $$;

