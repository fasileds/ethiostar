# 0010 — Custom database-backed session auth over an auth library

**Status:** ~~Accepted~~ **Superseded by [0014](0014-supabase-auth.md)** · 2026-08-12

> **Superseded.** The reasoning below was sound for a self-hosted Postgres. Adopting Supabase
> ([0013](0013-supabase-as-database-platform.md)) changed the decisive constraint: RLS policies key on
> `auth.uid()`, which only exists if GoTrue issues the token. Keeping custom sessions would mean
> maintaining a second identity system whose only job is to impersonate the first.
>
> Retained because it records _what the requirements were_, and [0014](0014-supabase-auth.md) is
> written as a mapping of these same requirements onto Supabase Auth.

## Context

Requirements that shape the choice:

- Two realms with different lifetimes and different shells: staff and customer.
- **Server-issued credentials** on customer approval, with a forced first-login change (M04).
- Immediate revocation — termination, suspicion, password change (custody business).
- RBAC with data scoping (branch / warehouse / room / own-customer).
- TOTP MFA for privileged roles.
- Every auth event audited: login, failure, lockout, logout, denial, impersonation.
- No social login, no OAuth provider, no external identity provider in scope.

## Decision

Build it, on well-reviewed primitives: `@node-rs/argon2` for hashing, `jose` for the sealed cookie,
`crypto.randomBytes` for tokens.

- **Opaque, database-backed sessions.** The cookie carries a signed+encrypted envelope with just
  enough for `proxy.ts` to make an optimistic redirect with zero database access; `user_session` is
  authoritative.
- Session id rotates on every privilege change (login, password change, MFA, role change).
- All of it lives in `src/server/auth/` and `src/modules/identity/` — roughly 400 lines.

## Consequences

**Positive**

- The security-critical code is ours, reviewable, and shaped exactly to the requirements.
- Revocation is a database update; there is no window in which a recalled session still works.
- The forced-password-change flow, the lockout policy and the audit hooks are first-class rather than
  bolted onto someone else's lifecycle.
- No dependency whose breaking change forces an auth migration mid-project.

**Negative**

- We own the security of it. Mitigated by: standard primitives only, no custom cryptography, a
  documented threat register ([../architecture/05-security.md §5.7](../architecture/05-security.md)),
  and a dedicated security pass in roadmap Step 24.
- Features a library gives free (social login, magic links, passkeys) would be work. None are in
  scope; passkeys are a plausible Phase 2 addition and the session model accommodates them.
- Requires care on the details that libraries get right by default: fixation, timing attacks, cookie
  attributes. Each is explicitly specified in §5.1 rather than left to judgement.

## Alternatives rejected

- **Auth.js / NextAuth.** Optimised for federated identity. Database sessions, forced password
  change, dual realms and scoped RBAC all end up as adapter customisation, and the result is harder
  to reason about than the direct implementation.
- **Lucia.** Close in philosophy to what we are building; entered maintenance mode as a library and
  now recommends implementing sessions directly — which is what this ADR does.
- **Keycloak / an external IdP.** A significant operational component (deploy, back up, patch) for a
  system with one organisation and no federation requirement. Reconsider only if EthioStar adopts an
  organisation-wide directory.
