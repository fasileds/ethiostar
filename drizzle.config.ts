import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit GENERATES the SQL; the Supabase CLI APPLIES it.
 *
 * Generated SQL is moved into supabase/migrations/<timestamp>_<NNNN>_<verb>_<subject>.sql,
 * hand-edited (triggers, RLS policies, EXCLUDE constraints, partitioning) and reviewed.
 * What is reviewed is exactly what runs.
 *
 * `drizzle-kit check` in CI compares this schema against the migrated database and fails
 * on drift — which is how a schema change made through the Supabase dashboard gets caught.
 *
 * Uses DIRECT_URL: migrations must not go through the transaction pooler.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './supabase/migrations',
  dbCredentials: {
    url: process.env.DIRECT_URL ?? '',
  },
  // Supabase owns these schemas; they are upgraded underneath us and must never be
  // in our migration surface. We extend via public.app_user with an FK to auth.users.
  schemaFilter: ['public'],
  verbose: true,
  strict: true,
})
