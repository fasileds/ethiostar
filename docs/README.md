# EthioStar CPMS — Engineering Documentation

Coffee Processing Management System for EthioStar Coffee Sorting & Processing Services.
Source of business truth: _EthioStar CPMS — Solution Overview & Module Summary v1.0_ (28 modules,
six layers, three phases).

**We are building Phase 1 only.** Phase 2 and Phase 3 are explicitly out of scope for
implementation, but in scope for _architecture_: the seams they need must exist now.

---

## How to read this

Read in order. Each document assumes the ones before it.

| #   | Document                                                                                 | What it settles                                                           |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | [architecture/01-principles-and-layering.md](architecture/01-principles-and-layering.md) | Architectural style, layers, dependency rules, how a request flows        |
| 2   | [architecture/02-project-structure.md](architecture/02-project-structure.md)             | Every directory and file, and why it exists                               |
| 3   | [architecture/03-domain-model.md](architecture/03-domain-model.md)                       | Aggregates, lifecycles, invariants, the stock ledger                      |
| 4   | [architecture/04-database-and-migrations.md](architecture/04-database-and-migrations.md) | Schema conventions, table catalogue, migration strategy                   |
| 5   | [architecture/05-security.md](architecture/05-security.md)                               | AuthN, RBAC + data scoping, RLS, threat register                          |
| 6   | [architecture/06-cross-cutting.md](architecture/06-cross-cutting.md)                     | Config, errors, logging, jobs, notifications, printing, i18n              |
| 7   | [architecture/07-extension-points.md](architecture/07-extension-points.md)               | The exact seams Phase 2 and Phase 3 plug into                             |
| 8   | [architecture/08-testing.md](architecture/08-testing.md)                                 | Test strategy, layers, tooling, what must be tested                       |
| 9   | [architecture/09-operations.md](architecture/09-operations.md)                           | Environments, deployment, backup, observability, runbooks                 |
| 10  | [architecture/10-risks-and-antipatterns.md](architecture/10-risks-and-antipatterns.md)   | Traps to avoid, with the reason each one bites                            |
| 11  | [phase-1/scope.md](phase-1/scope.md)                                                     | Phase 1 module scope and the Phase 1/2 boundary rulings                   |
| 12  | [phase-1/roadmap.md](phase-1/roadmap.md)                                                 | **The build order.** 24 steps, files per step, definition of done         |
| 13  | [phase-1/acceptance-criteria.md](phase-1/acceptance-criteria.md)                         | Per-module acceptance criteria traced to the client document              |
| 14  | **[phase-1/STATUS.md](phase-1/STATUS.md)**                                               | **What is actually built right now.** Read this before writing code.      |
| —   | [adr/](adr/)                                                                             | Architecture Decision Records — the _why_ behind each irreversible choice |

If you are implementing, live in **[phase-1/roadmap.md](phase-1/roadmap.md)** and consult the rest
as reference.

---

## Confirmed technical context

Verified in this repository, not assumed:

- **Next.js 16.3.0**, App Router, Turbopack by default, React 19.2.8.
- **Node.js 20.20.2** (Next 16 minimum is 20.9), npm 10.8.2.
- **PostgreSQL 17.4** available locally; **Docker 29.0.1** available (needed for `supabase start`).
- TypeScript 5, Tailwind CSS v4, ESLint 9 flat config.

**Database platform: Supabase** — Postgres + GoTrue auth + Storage + RLS. Data access is **Drizzle
over a direct Postgres connection**, not PostgREST. Read
[adr/0013](adr/0013-supabase-as-database-platform.md) before anything else; its rule confining
`service_role` to three sanctioned uses is the load-bearing security control of the entire system,
because `service_role` bypasses RLS completely.

Next.js 16 specifics that this plan depends on and that differ from older material:

- `middleware.ts` is deprecated — the convention is **`proxy.ts`**, exporting `proxy()`, Node.js
  runtime only.
- `cookies()`, `headers()`, `draftMode()`, `params`, `searchParams` are **async-only**.
- `revalidateTag(tag, profile)` requires a `cacheLife` profile; `updateTag(tag)` gives
  read-your-writes inside Server Actions; `refresh()` refreshes the client router from an action.
- `cacheLife` / `cacheTag` are stable (no `unstable_` prefix). PPR is now the `cacheComponents` flag.
- Type helpers `PageProps<'/route'>`, `LayoutProps<'/route'>`, `RouteContext<'/route'>` are
  generated by `next typegen`.
- `forbidden()` / `unauthorized()` and `forbidden.tsx` / `unauthorized.tsx` are **experimental**
  (behind `authInterrupts`). This plan does not depend on them; see
  [adr/0011-authorization-model.md](adr/0011-authorization-model.md).

---

## Assumptions this plan makes

Flagged here so they can be corrected cheaply before code is written.

1. **Single-plant, multi-warehouse to start**, with a `branch` dimension present from day one so a
   second site never requires a schema migration of the operational tables.
2. **Supabase Cloud for development and staging.** Production placement — hosted or self-hosted
   Supabase — is an open decision for EthioStar, because hosted makes the plant's internet link a
   hard dependency for the gate and receiving screens. The application code is identical either way;
   only environment variables and runbooks differ. See
   [architecture/09-operations.md §9.0](architecture/09-operations.md) and
   [adr/0013](adr/0013-supabase-as-database-platform.md). **Decide before roadmap Step 24.**
3. **The app and worker are deployed by us** (Docker, single VM to start). Supabase hosts the
   database, auth and storage. The plan avoids any Vercel-only primitive.
4. **Currency is ETB**, single currency, but money is stored with an explicit currency code.
5. **Locales are `en` and `am`** (Amharic). Printed documents must be producible in both.
6. **Weights are manual entry with a named witness** — the document puts weighbridge integration
   out of scope. The schema records the witness; the integration seam exists but is not built.
7. **No SMS in Phase 1.** Email only. The channel abstraction accepts SMS without redesign.
8. **File storage is Supabase Storage**, private buckets with short-lived signed URLs. Virus
   scanning remains ours (ClamAV) — Supabase does not scan uploads.

Anything above that is wrong is a five-minute correction now and a large one later.
