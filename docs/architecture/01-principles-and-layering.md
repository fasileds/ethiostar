# 1. Principles and Layering

## 1.1 Architectural style: modular monolith, layered inside each module

One deployable Next.js application plus one background worker process, internally partitioned into
**feature modules** with enforced dependency rules.

Why not microservices: the entire value of this system is a _consistent custody record_. Weight,
stock, capacity and bag counts must move in one database transaction or the record is not
defensible. Distributing that across services buys deployment independence EthioStar does not need
and costs transactional integrity the business cannot lose. A modular monolith with hard internal
boundaries gives the maintainability benefit without the distributed-systems tax, and any module can
be extracted later precisely _because_ the boundaries are enforced.

Why not a single unstructured Next.js app: 28 modules, 12 roles and a legally significant audit
trail will not survive "business logic in the Server Action". The layering below is what keeps files
small, testable and independently changeable.

## 1.2 The four layers inside a module

```
              ┌─────────────────────────────────────────────────────────────┐
   app/       │  ROUTING           pages, layouts, route handlers            │  Next.js only
              │  - resolves params, renders UI, calls interface layer        │
              └──────────────────────────┬──────────────────────────────────┘
                                         │
              ┌──────────────────────────▼──────────────────────────────────┐
   interface/ │  INTERFACE         server actions, HTTP controllers, DTOs    │  knows HTTP/forms
              │  - parse + validate input (Zod), map errors, map DTOs        │
              └──────────────────────────┬──────────────────────────────────┘
                                         │
              ┌──────────────────────────▼──────────────────────────────────┐
   application│  APPLICATION       use cases / services, ports, unit of work │  knows orchestration
              │  - authorize, open transaction, call domain, emit events     │
              └──────────────────────────┬──────────────────────────────────┘
                                         │
              ┌──────────────────────────▼──────────────────────────────────┐
   domain/    │  DOMAIN            entities, value objects, policies, rules  │  knows nothing else
              │  - pure TypeScript, no I/O, no framework, no DB              │
              └─────────────────────────────────────────────────────────────┘
                                         ▲
              ┌──────────────────────────┴──────────────────────────────────┐
 infrastructure│ INFRASTRUCTURE   repositories, Drizzle queries, adapters    │  implements ports
              └─────────────────────────────────────────────────────────────┘
```

**The rule that matters:** dependencies point inward. `domain/` imports nothing from the other three
layers. `infrastructure/` implements interfaces (`ports`) declared by `application/`. This is
plain hexagonal architecture, applied only where it pays.

### What goes in each layer, concretely

| Layer            | Contains                                                                                                 | Must NOT contain                                                          | Example file                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| `domain`         | Entities, value objects, state machines, invariants, domain errors, pure calculations                    | `import` of drizzle, next, zod-of-http-shape, `Date.now()`, `process.env` | `processing/domain/mass-balance.ts`                |
| `application`    | Use case classes/functions, port interfaces, transaction boundaries, event emission, authorization calls | SQL, React, `NextRequest`                                                 | `processing/application/close-job.usecase.ts`      |
| `infrastructure` | Repository implementations, Drizzle queries, row↔entity mappers, external adapters                       | Business rules                                                            | `processing/infrastructure/job.repository.ts`      |
| `interface`      | Zod input schemas, Server Actions, route handler bodies, DTO shaping for the client                      | Business rules, direct DB access                                          | `processing/interface/actions/close-job.action.ts` |

### Deliberate pragmatism

Full hexagonal ceremony on every module is over-engineering. The rules we actually apply:

- **Every module has `domain/` and `infrastructure/`.** Non-negotiable — this is what makes rules
  testable without a database.
- **`application/` use cases exist for anything that writes**, and for reads with authorization
  logic. Trivial reference-data reads may go interface → repository directly.
- **Ports (interfaces) are declared only where a second implementation is genuinely plausible**:
  mailer, file storage, virus scanner, PDF renderer, clock, ID generator, queue, rate limiter,
  customer-hold policy. Not for repositories of a module that will never have a second backing
  store — those are concrete classes with an interface extracted only if a test needs it. See
  [adr/0006-ports-only-where-justified.md](../adr/0006-ports-only-where-justified.md).
- **Repositories return domain entities, never Drizzle rows.** The mapper is the boundary.

## 1.3 Module dependency rules

Modules are assigned a **tier**. A module may import from `core`, `platform`, `db`, and from modules
in a _strictly lower_ tier. Same-tier imports are forbidden — if two same-tier modules need each
other, either the dependency belongs in a lower tier or the two modules are one module.

```
tier 0  core            (Result, errors, units, ids, clock, logging, i18n, validation helpers)
tier 0  db              (client, schema, transaction/unit-of-work)
tier 0  platform        (mailer, storage, antivirus, pdf, barcode, queue, cache, ratelimit)

tier 1  identity        M01  users, roles, permissions, sessions, scopes
tier 1  master-data     M02  coffee/grade/region/bag-type/output-classification/reason codes
tier 1  audit           M07  audit log, domain event store, outbox

tier 2  notification    M04  templates, dispatch, delivery log
tier 2  printing        M06  numbering series, PDF/label rendering, QR, printed-document registry
tier 2  files           (Phase-1 seam for M05) stored files, checksums, scan status, links
tier 2  warehouse       M12  warehouse → room → section, capacity engine, reservations
tier 2  customers            customer aggregate, contacts, documents, holds

tier 3  onboarding      M08  public application, KYC checklist, verification, approval → customer
tier 3  stock                append-only stock ledger, balance projection, adjustments, counts
tier 3  kesha           M13  bag types, empty-bag inventory, customer-owned bags, reconciliation
tier 3  labour          M18  gangs, workers, piece rates, earnings, vouchers

tier 4  consignment          the operational spine: consignment + lot + lifecycle state machine
tier 5  inbound         M11  delivery request → capacity check → goods receipt → placement
tier 5  scheduling      M14  processing request → appointment → reschedule/delay
tier 5  processing      M15  job order → outputs → mass balance
tier 5  acceptance      M16  Mirt Merekebiya acceptance pack + signature
tier 5  dispatch        M17  release request → clearance → loading → gate pass → gate-out

tier 6  portal          M09  customer-facing read models and use cases
tier 6  administration  M23  settings console, numbering config, support desk, health
```

Cross-tier communication that would create a cycle uses **domain events** instead of an import.
Example: `inbound` must not import `notification`; it emits `ConsignmentReceived`, and the
`notification` module subscribes. This is the same mechanism Phase 2 billing and Phase 3 AI will
use, which is why it is worth having on day one.

**Enforcement is automated, not cultural.** `eslint-plugin-boundaries` plus `dependency-cruiser` in
CI fail the build on a violation. A rule nobody can break is worth ten pages of guidance.

## 1.4 How a write request flows

Taking "store keeper confirms the kesha count on a goods receipt" end to end:

```
1  app/(staff)/receiving/[grnId]/page.tsx
      renders <ConfirmKeshaCountForm/> (client component) with a Server Action reference

2  src/modules/inbound/interface/actions/confirm-kesha-count.action.ts        ('use server')
      - withAction() wrapper: request id, actor resolution, rate limit, error mapping
      - Zod parse of FormData -> ConfirmKeshaCountInput
      - delegates immediately; contains no business logic

3  src/modules/inbound/application/confirm-kesha-count.usecase.ts
      - requirePermission(actor, 'goods_receipt:confirm_count', { warehouseId })
      - unitOfWork.run(async (tx) => {
          load GoodsReceipt aggregate via repository
          domain: receipt.confirmKeshaCount(lines, actor, clock.now())   <-- rules live here
          persist aggregate
          stock.postMovements(tx, movements)          (ledger append)
          events.append(tx, receipt.pullEvents())     (domain_event + outbox, same tx)
        })
      - returns a DTO, never an entity

4  worker (separate process) drains the outbox
      - notification: "coffee received at gate" email to customer
      - labour: create LabourActivity from the confirmed count
      - audit: (already written transactionally; outbox is for side effects only)

5  back in the action
      - updateTag(`consignment:${id}`)  -> read-your-writes for the operator
      - returns { ok: true, data } | { ok: false, error }
```

Four properties this buys, each of which is a stated requirement in the client document:

- The business rule is in one pure function and is unit-testable with no database.
- The audit event and the business change cannot diverge — same transaction.
- Labour pay is derived from the store keeper's confirmed count, never re-keyed (M18 key control).
- The notification log is evidence of what the customer was told and when (M04 key control).

## 1.5 Server Actions vs Route Handlers

Both exist; they are not interchangeable.

**Server Actions** — for mutations driven by our own UI. Progressive enhancement, no hand-written
fetch, typed end to end. Every action is wrapped by `withAction()` and **re-authorizes internally**:
a Server Action is a public POST endpoint whose ID is discoverable, so a page-level guard is not a
guard. This is stated explicitly in the Next.js data-security guide and is a hard rule here.

**Route Handlers under `app/api/v1/`** — for anything that is not our own React UI:

- the public customer application form (aggressive rate limiting, no session),
- file upload and authorized file download (streaming, content-type control),
- document/label PDF generation (binary responses),
- QR resolution (`/api/v1/scan/:token`),
- health, readiness and metrics endpoints,
- **the Phase 2 mobile application (M22)** — the reason the API is versioned from day one.

Route handlers never contain business logic either; they call the same use cases the actions do.

## 1.6 Rendering and data-fetching posture

- **Server Components by default.** Client Components only for interactivity, and marked
  `'use client'` at the leaf, not at the page.
- **No `fetch()` to our own API from Server Components.** Server code calls the use case directly.
  The API exists for external callers.
- **Cache posture: dynamic by default.** This is an operational system where a stale stock figure is
  a commercial dispute. We do not enable `cacheComponents` in Phase 1. Caching is applied
  deliberately and narrowly to master data via `use cache` + `cacheTag` + `cacheLife`, invalidated
  with `updateTag` on edit. See [adr/0009-caching-posture.md](../adr/0009-caching-posture.md).
- **Mutations use `updateTag()`** (read-your-writes) rather than `revalidateTag()` wherever the
  acting user must immediately see their own change — which, in this system, is almost always.

## 1.7 Naming and file conventions

| Thing                | Convention                                                    | Example                               |
| -------------------- | ------------------------------------------------------------- | ------------------------------------- |
| Directories          | `kebab-case`                                                  | `master-data/`, `goods-receipt/`      |
| Domain entity file   | `<entity>.entity.ts`                                          | `consignment.entity.ts`               |
| Value object         | `<name>.vo.ts`                                                | `weight.vo.ts`                        |
| Use case             | `<verb>-<subject>.usecase.ts`                                 | `approve-delivery-request.usecase.ts` |
| Repository interface | `<entity>.repository.ts` (in `application/ports/`)            | `job.repository.ts`                   |
| Repository impl      | `<entity>.repository.ts` (in `infrastructure/`)               | same name, different layer            |
| Server Action        | `<verb>-<subject>.action.ts`, exports `<verbSubject>Action`   | `closeJobAction`                      |
| Zod schema           | `<subject>.schema.ts`, exports `xSchema` + `type X`           | `delivery-request.schema.ts`          |
| DB table             | `snake_case`, **singular**                                    | `goods_receipt`, `stock_movement`     |
| DB column            | `snake_case`; FKs `<table>_id`                                | `consignment_id`                      |
| Migration            | `NNNN_<verb>_<subject>.sql`                                   | `0013_create_inbound_tables.sql`      |
| React component      | `PascalCase.tsx`                                              | `ConsignmentTimeline.tsx`             |
| Test                 | `<subject>.test.ts` co-located, `*.int.test.ts` for DB-backed | `mass-balance.test.ts`                |
| Permission string    | `<resource>:<action>`                                         | `delivery_request:approve`            |
| Domain event         | `<Aggregate><PastTenseVerb>`                                  | `ConsignmentReceived`                 |

**Hard limits, enforced by lint:** no file over 300 lines; no function over 50 lines; no more than
one exported React component per file. These exist to prevent the monolithic-file failure mode, and
they are cheap to satisfy if the layering above is respected.

## 1.8 Ubiquitous language

Use the client document's vocabulary in code, including the Amharic terms. Do not "translate" them
into generic software nouns — a `MirtMerekebiya` is not a `Receipt`, and calling it one loses the
meaning that the customer takes ownership while the coffee stays in EthioStar's store.

| Term            | Code identifier                 | Meaning                                                                          |
| --------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| Consignment     | `Consignment`                   | One delivery from one customer under one delivery request                        |
| Lot             | `Lot`                           | Separately identifiable quantity within a consignment; outputs become child lots |
| Kesha           | `Kesha`, `keshaCount`           | The bag; the counted unit; the basis of labour pay                               |
| GRN             | `GoodsReceipt`                  | Goods Receiving Note                                                             |
| Mirt Merekebiya | `MirtMerekebiya` / `Acceptance` | Formal customer acceptance of processed outputs                                  |
| Mass balance    | `MassBalance`                   | input = Σ outputs + recorded loss                                                |
| Yield           | `Yield`                         | % of input weight recovered as each output classification                        |
| Dwell time      | `dwellDays`                     | Days a lot has been held in store                                                |
| Gate pass       | `GatePass`                      | Numbered authorisation for a vehicle to leave                                    |
