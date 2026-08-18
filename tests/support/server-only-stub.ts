/**
 * Stub for the `server-only` package under Vitest.
 *
 * `server-only` deliberately throws when imported outside a React Server Component. That
 * is a BUILD-TIME guard enforced by the bundler — it still applies to `next build`, which
 * is where it protects us. Under a plain Node test runner it only prevents server modules
 * from being unit-tested at all.
 */
export {}
