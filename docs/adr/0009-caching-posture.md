# 0009 — Dynamic by default; `cacheComponents` off in Phase 1

**Status:** Accepted · 2026-08-12

## Context

Next.js 16 offers `cacheComponents` (the successor to Partial Prerendering), `use cache`,
`cacheLife`, `cacheTag`, `revalidateTag(tag, profile)` and `updateTag`. These are powerful for
content-shaped applications.

CPMS is not content-shaped. A stale stock figure is a commercial dispute; a stale capacity number
means coffee accepted against space that does not exist; a stale appointment is a customer at the
gate on the wrong day. Almost every page is per-user and per-permission.

## Decision

- **`cacheComponents` stays off in Phase 1.** Pages render dynamically.
- **`use cache` is applied narrowly and deliberately** — master data lists, permission catalogues,
  notification templates, document templates. Each gets an explicit `cacheTag` and a `cacheLife`
  profile.
- **Mutations use `updateTag()`**, not `revalidateTag()`, wherever the acting user must immediately
  see their own change — which is nearly always in an operational system. `revalidateTag(tag,
profile)` is used only for master data where stale-while-revalidate is acceptable.
- `refresh()` is used after actions that change data displayed in the shell (for example, a pending-
  action count in the header).
- Client-side caching is left to the router's defaults; `staleTimes` is not tuned in Phase 1.

## Consequences

**Positive**

- Correctness by default. No class of "the screen was stale" incidents.
- The CSP nonce (which forces dynamic rendering) costs nothing, because pages are dynamic anyway.
- Simpler mental model while eighteen modules are being built by a team learning the domain.

**Negative**

- Higher server load per request. Acceptable: this is an internal system with a bounded user
  population, not a public site.
- Some obvious caching wins are left on the table. That is a deliberate Phase 2 optimisation, done
  with real measurements from M21's usage rather than guesses now.

## Revisit when

- M21 (Phase 2) introduces dashboards that aggregate across the whole database — those are the first
  genuine `use cache` candidates.
- Load testing (roadmap Step 24) identifies a specific hot read that is safe to cache. Cache the
  measured problem, not the imagined one.

## Alternatives rejected

- **`cacheComponents: true` from the start.** Adds a caching model to reason about on every page,
  while the dominant risk is stale operational data.
- **Aggressive route-level caching.** Would require per-user cache keys almost everywhere, which is
  most of the cost of caching and little of the benefit.
