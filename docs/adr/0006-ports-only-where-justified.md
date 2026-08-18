# 0006 — Ports and adapters only where a second implementation is plausible

**Status:** Accepted · 2026-08-12

## Context

Hexagonal architecture applied uniformly produces an interface for every class, a folder for every
interface, and a codebase where finding the code that runs takes three jumps. Applied selectively it
produces testability and genuine swappability. The brief asks explicitly to avoid over-engineering
while leaving real extension points.

## Decision

Declare a port only when at least one is true:

1. A second implementation is genuinely plausible (a Phase 2/3 module, or a different deployment).
2. Tests need to substitute it to be fast or deterministic.
3. It crosses a process or network boundary.

**Ports we declare:**

| Port                         | Justification                                    |
| ---------------------------- | ------------------------------------------------ |
| `NotificationChannel`        | SMS/push arrive in Phase 2                       |
| `FileStorage`, `FileScanner` | local vs S3; tests need fakes                    |
| `DocumentRenderer`           | rendering engine may change; tests need fakes    |
| `Clock`, `IdGenerator`       | determinism in tests — non-negotiable            |
| `Queue`                      | worker substitution in tests                     |
| `RateLimiter`                | Redis is a plausible later backend               |
| `CustomerHoldPolicy`         | Phase 2 adds a financial hold (Seam 4)           |
| `ApprovalPolicy`             | Phase 2 M03 replaces the implementation (Seam 3) |
| `PlacementStrategy`          | Phase 3 M26 adds an AI implementation            |
| `Logger`, `Metrics`          | vendor substitution                              |

**Ports we do not declare:** repositories of modules that will only ever use Postgres, mappers,
domain services, value objects, use cases. These are concrete. Integration tests run against a real
database via Testcontainers, so a repository interface would exist solely to enable mocks — and
mocked repositories test the mock, not the SQL, which is where repository bugs actually live.

## Consequences

**Positive**

- Ten interfaces that each earn their keep, instead of a hundred that do not.
- Navigation stays direct: most call sites reach the real implementation in one jump.
- The extension points that matter are visible precisely because they are rare.

**Negative**

- Introducing a port later is a small refactor. Acceptable — and the layering makes it a mechanical
  one, confined to the module.
- A developer trained in strict hexagonal architecture may find it inconsistent. The rule above is
  the answer, and it is written down.

## Alternatives rejected

- **Interface everything.** Ceremony with no payoff; obscures which seams are real.
- **Interface nothing.** Loses test determinism (clock, ids) and the Phase 2 seams that are the whole
  point of the extension-point analysis.
