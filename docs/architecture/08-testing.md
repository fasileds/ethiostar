# 8. Testing and Quality Strategy

The layering in §1 exists largely so that the rules that matter can be tested without a browser or a
database. This document says what gets tested, how, and what blocks a merge.

---

## 8.1 The shape of the suite

```
        ▲  few, slow, high confidence
        │   E2E (Playwright)                    ~25 specs — the 4 business journeys + auth
        │   Integration (Vitest + Testcontainers) ~150 — repositories, RLS, transactions, use cases
        │   Unit (Vitest)                        ~600 — domain rules, policies, value objects, mappers
        ▼  many, fast, precise
```

Deliberately heavy at the bottom. The domain layer is pure by construction, so a mass-balance test
runs in under a millisecond and there is no excuse for not having fifty of them.

| Layer       | Tool                                  | Database       | Target runtime     |
| ----------- | ------------------------------------- | -------------- | ------------------ |
| Unit        | Vitest                                | none           | whole suite < 10 s |
| Integration | Vitest + Testcontainers (postgres:17) | real, migrated | < 3 min            |
| E2E         | Playwright                            | real, seeded   | < 8 min            |

---

## 8.2 What must be tested — the non-negotiable list

These are the tests that, if missing, mean the system is not fit for a custody business.

### Domain (unit)

1. **Consignment state machine — exhaustive.** For every (from, to) pair in the full cartesian
   product of statuses, assert legal or illegal. Generated from the transition table, so adding a
   status forces the test to be updated.
2. **Mass balance.** Within tolerance closes; outside tolerance refuses; outside tolerance with an
   explanation and the right permission closes; the explanation is recorded; yields sum correctly;
   zero input is rejected.
3. **Weight and Money arithmetic.** Property-based (`fast-check`): associativity, no precision loss
   across a thousand random operations, refusal of negative and over-precise values. This is where a
   float bug would hide.
4. **Unit conversion.** kg ↔ kesha with standard and actual weights; average-per-kesha; outlier
   detection thresholds.
5. **Capacity calculation.** available = capacity × safe-fill − occupied − reserved, across the
   three-level hierarchy; boundary cases at exactly full and exactly at threshold.
6. **Placement strategy.** Proposals never exceed available capacity; deterministic given the same
   input; prefers fewest splits.
7. **Piece-rate calculation.** Equal split and by-individual-count; overtime/night/holiday
   multipliers; effective-date selection picks the version live on the activity date, not today.
8. **Bag reconciliation identity.** in + issued = filled + returned + condemned + variance, over
   randomised inputs.
9. **Eligibility specifications.** Lots in store; lots not already committed; customer not on hold.
10. **Document number formatting.** Yearly reset, zero-padding, prefix, no gaps under concurrent
    allocation (this one is integration).

### Integration (real Postgres)

11. **Stock ledger invariants.** After any sequence of operations, `SUM(stock_movement) =
stock_balance` for every (lot, location). Run as a property test over randomised operation
    sequences — this catches projection bugs that example-based tests miss.
12. **Transfer atomicity.** A transfer produces exactly two rows with a net of zero and one
    correlation id; a failure mid-way leaves neither.
13. **Append-only enforcement.** `UPDATE` and `DELETE` on each append-only table raise. Run as the
    application role, not as owner — testing as owner proves nothing.
14. **RLS isolation.** Two interleaved transactions on the same pooled connection: customer A cannot
    see customer B's rows, and A's `set_config` does not leak into B's transaction. **This is the
    single most important integration test in the suite.**
15. **Capacity race.** Two concurrent approvals for the same room where only one fits: exactly one
    succeeds, and the loser gets a capacity error, not a constraint violation.
16. **Appointment overlap.** Two concurrent bookings on one line at the same time: the exclusion
    constraint rejects one.
17. **Optimistic concurrency.** Two writers, stale version → `ConcurrencyError`.
18. **Numbering under concurrency.** N parallel allocations produce N contiguous numbers, no gaps,
    no duplicates; a rolled-back transaction does not consume a number.
19. **Outbox delivery.** At-least-once; handlers are idempotent; failures retry with backoff and
    land in the dead-letter table after `max_attempts`.
20. **Audit trigger.** Every write records before/after values and the actor; a write without
    `app.actor_id` set is rejected.
21. **Cross-tenant probe (systematic).** For every customer-facing route and every id-taking use
    case, request another customer's id and assert `404`.
22. **Migrations.** Apply cleanly to empty; apply cleanly onto a production-shaped dump;
    `drizzle-kit check` reports no drift.

### E2E (Playwright)

23. **Journey 1 — Onboarding.** Public application → document upload → staff verification →
    approval → credential email captured → activation → forced password change → customer dashboard.
24. **Journey 2 — Inbound.** Delivery request → capacity check → approval → GRN with weights and
    witness → kesha confirmation → placement → labour activity created automatically → GRN PDF
    printed and numbered.
25. **Journey 3 — Processing.** Processing request → appointment → reschedule with delay reason →
    **customer receives the delay notification** → job start → four outputs → mass balance →
    close → Mirt Merekebiya issued → customer signs in the portal.
26. **Journey 4 — Dispatch.** Release request → clearance check (including a blocked case) →
    loading → gate pass issued → gate scan → gate-out → stock deducted → consignment closed.
27. **Authorization matrix.** For each of the twelve roles, assert the navigation it sees and that a
    forbidden route returns 403 rather than rendering.

Journeys 1–4 are the four stages of the client document's Section 3. If they pass, the system runs
the business.

---

## 8.3 Test infrastructure

### Database

One Postgres container per worker process, migrated once at global setup. Between tests, truncate
rather than re-migrate:

```sql
TRUNCATE TABLE <all business tables> RESTART IDENTITY CASCADE;
```

Reference data (permissions, roles, master data) is re-seeded after truncation from the same seed
files production uses — which also means the seeds are continuously tested.

Never run integration tests against a shared developer database. Testcontainers makes an isolated
one cheap, and shared-database test suites fail mysteriously and get disabled.

### Builders, not fixtures

```ts
const customer = await aCustomer()
  .approved()
  .withDocument('TRADE_LICENCE', { expiresOn: '2027-01-01' })
  .build()
const consignment = await aConsignment()
  .forCustomer(customer)
  .received({ kg: 30_000, kesha: 500 })
  .stored()
  .build()
```

Builders express intent and default everything else. Static JSON fixtures rot within a month of
schema change and produce tests nobody can read.

### Deterministic time

`FrozenClock` injected everywhere. Any test that calls `new Date()` is a flaky test waiting for a
month boundary. A lint rule bans `Date.now()` and `new Date()` outside `core/clock` and
`core/utils/date`.

### Fakes over mocks

`FakeMailer`, `FakeFileStorage`, `FakeScanner`, `InMemoryQueue` — real implementations of the ports
with inspectable state. Assert `mailer.sent` contains a message with the right template code and
recipient. Mocking frameworks assert _how_ code was called; fakes assert _what happened_, which is
what actually matters and survives refactoring.

---

## 8.4 Quality gates

CI runs on every push and blocks merge:

```
1  typecheck        tsc --noEmit                                       (strict, no errors)
2  lint             eslint                                             (no warnings)
3  boundaries       eslint-plugin-boundaries + dependency-cruiser       (no violations, no cycles)
4  format           prettier --check
5  unit             vitest run --coverage
6  integration      vitest run --project=integration                    (Testcontainers)
7  migrations       apply to empty + apply to restored dump + drift check
8  build            next build                                          (must succeed, no type errors)
9  e2e              playwright test                                     (on PRs to main + nightly)
10 audit            npm audit --production + license check
11 secrets          gitleaks
```

**Coverage thresholds, differentiated by layer** — a single global number rewards testing getters:

| Layer                          | Lines | Branches |
| ------------------------------ | ----- | -------- |
| `src/modules/*/domain/**`      | 95%   | 90%      |
| `src/modules/*/application/**` | 85%   | 80%      |
| `src/core/**`                  | 90%   | 85%      |
| everything else                | 60%   | —        |

The domain layer is where the business rules live and where a bug is a commercial dispute. Holding
it to 95% is realistic precisely because it is pure.

---

## 8.5 Additional quality practices

- **Architecture tests.** Programmatic assertions that `domain/` imports nothing from
  `infrastructure/`, that no module imports another module's internals, and that no `*.usecase.ts`
  is missing an authorization call. Cheap to write, and they prevent the slow erosion that makes
  layered architectures stop paying.
- **Contract snapshot for the API.** OpenAPI generated from the Zod schemas
  (`zod-to-openapi`) and committed. A diff in the generated spec forces a conscious decision, which
  matters once M22 depends on it.
- **PDF golden tests.** Render each document to PDF, extract text, snapshot. Catches "the gate pass
  lost its number" — a class of bug that is invisible until a truck is at the gate.
- **Load test the two hot paths** before go-live: the portal stock view and the receiving flow at
  harvest-peak concurrency. `k6`, scripted, in `ops/`.
- **Restore drill.** A CI job restores the previous night's backup into a scratch database and runs
  the migration check against it. A backup that has never been restored is a hypothesis.
- **Accessibility.** `axe` in the Playwright journeys. The gate and receiving screens are used on
  cheap tablets in poor light; contrast and target size are functional requirements here, not
  compliance box-ticking.
- **Seed-and-explore environment.** `npm run seed:demo` produces a full season of realistic data —
  the fastest way to find the queries that fall over and the screens that do not scale.
