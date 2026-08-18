# 0004 — Lookup tables for business-configurable values

**Status:** Accepted · 2026-08-12

## Context

M02 requires that the four output classifications be _"defined as configurable records so additional
classifications can be added later without redevelopment"_. The same argument applies to coffee
types, grades, bag types, reason codes, delay categories, document types and labour activity types.

Postgres enums are also operationally awkward: `ALTER TYPE … ADD VALUE` cannot run inside a
transaction, and removing a value requires recreating the type and rewriting every dependent column.

## Decision

- **Business-configurable values** → lookup tables with a stable `code`, `name_en`, `name_am`,
  `sort_order`, `is_active`, and effective dates where versioning applies.
- **Closed technical sets** (consignment status, movement type, notification channel, job status) →
  `text` + `CHECK` constraint, not `CREATE TYPE`.
- Application code refers to lookup rows by `code`, never by UUID and never by display name.
- A `code` becomes immutable once referenced by a transaction.

## Consequences

**Positive**

- A fifth output classification is a row insert through the admin UI, satisfying the M02 requirement
  literally.
- Bilingual display names live with the data, so nothing has to be translated in the UI layer.
- Deactivating a value preserves history — existing references stay valid, new selection is blocked.
- Altering a `CHECK` constraint is a cheap, reversible DDL; altering an enum type is not.

**Negative**

- A join or a cached lookup for display. Master data is small and cached with a short TTL.
- No compile-time exhaustiveness over lookup values. Mitigated by typed `code` constants for the
  handful of codes that carry special behaviour (`APPROVED` / `is_primary`), with a startup assertion
  that those rows exist.

## Alternatives rejected

- **Postgres enums everywhere.** Compile-time safety at the cost of the M02 requirement and painful
  migrations.
- **TypeScript union types only.** Adding a classification becomes a code change and a deploy —
  precisely what the document says must not be necessary.
