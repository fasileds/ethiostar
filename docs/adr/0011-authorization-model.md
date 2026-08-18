# 0011 — Permission strings plus data scoping, checked in the use case

**Status:** Accepted · 2026-08-12

## Context

M01 defines a permission as _"a specific action on a specific object, such as 'approve delivery
request' or 'post stock adjustment'"_, requires the twelve named roles to be configurable, and
requires data scoping so _"a store keeper of Room A cannot post movements in Room B."_

Two structural facts about Next.js App Router constrain where checks can live:

- A Server Action is a directly reachable POST endpoint. A guard in `page.tsx` guards the UI, not
  the action.
- `proxy.ts` runs on every request including prefetches, so it cannot afford database lookups and is
  therefore optimistic only.

## Decision

- Permissions are `<resource>:<action>` strings. The **catalogue lives in code** and is synced to the
  database on every deploy; the **role → permission mapping lives in the database** and is
  administrator-editable (M23).
- Scope is a separate, orthogonal dimension carried on the `Actor`
  (`global | branch | warehouse | room | customer`).
- **One decision point:** `requirePermission(actor, permission, target?)` in
  `src/server/auth/authorize.ts`. Deny by default. Every denial is audited.
- Called at the top of **every** use case that writes, and every read of another party's data.
- Object-level ownership is asserted separately after loading an entity (`assertAccessible`), because
  holding a permission does not imply access to a specific row. Cross-tenant probes return **404**,
  not 403.
- Read queries apply the scope predicate via `applyScope(qb, actor)`; RLS backs it (ADR 0005).
- Client-side permission checks exist only to hide UI, never as a control.

## Consequences

**Positive**

- A single place to reason about, audit and test. The architecture test asserting that every
  `*.usecase.ts` calls `requirePermission` makes omission visible in review, not in an incident.
- Permission denials become a security signal, and feed Phase 3's M27 risk monitoring for free.
- The mobile app (M22) and the API inherit the same checks, because the check is in the use case, not
  the transport.

**Negative**

- A check in every use case is repetitive. It is also the only placement that is correct; the
  `withAction` wrapper removes most of the boilerplate.
- Adding a permission requires a code change (deliberately — it is a code-level capability), while
  _granting_ it does not.

## On `forbidden()` / `unauthorized()`

Next 16 ships `forbidden()`, `unauthorized()`, `forbidden.tsx` and `unauthorized.tsx`, but they are
**experimental**, gated behind the `authInterrupts` config flag. Phase 1 does not depend on them:
authorization failures return a typed `ForbiddenError` mapped by `withAction`/`withRoute`. Adopt them
in Phase 2 if they stabilise — the mapping layer is the only thing that would change.

## Alternatives rejected

- **Checks in `proxy.ts` only.** Runs on prefetches, cannot do database checks cheaply, and does not
  cover Server Actions at all.
- **Checks in `page.tsx` only.** Leaves every Server Action unguarded. This is the most common
  App Router security failure and the Next.js data-security guide is explicit about it.
- **A full policy engine (Casbin, OPA).** Real capability, but the rules here are permission +
  scope + ownership. A policy DSL adds a language to learn and debug for expressiveness nothing
  needs. Revisit if Phase 2's M03 introduces genuinely conditional, data-dependent authorization.
- **Attribute-based access control throughout.** Over-general for twelve well-understood roles.
