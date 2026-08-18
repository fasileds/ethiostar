# 0014 — Supabase Auth (GoTrue) for authentication

**Status:** Accepted · 2026-08-12
**Supersedes:** [0010](0010-custom-session-auth.md)

## Context

[ADR 0010](0010-custom-session-auth.md) chose custom database-backed session auth, on the reasoning
that no library fitted the requirements: two realms, server-issued credentials with a forced first
change, immediate revocation, scoped RBAC, TOTP, and full audit.

Adopting Supabase ([0013](0013-supabase-as-database-platform.md)) changes the calculus decisively.
RLS policies key on `auth.uid()`, which is derived from the JWT GoTrue issues. Keeping custom
sessions would mean either abandoning `auth.uid()`-based RLS — losing the main benefit of the
platform — or maintaining two parallel identity systems that must never disagree. Both are worse than
adapting to GoTrue.

## Decision

Use **Supabase Auth**. Map the requirements onto it as follows:

| Requirement                  | Implementation                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity store               | `auth.users` (GoTrue). Our `app_user` profile table holds the domain attributes, `id` FK to `auth.users.id`.                                               |
| Two realms                   | `actor_kind` (`staff` \| `customer`) claim, injected by the Custom Access Token hook.                                                                      |
| RBAC + scope                 | `role`, `permissions_version` and `scope` claims from the same hook, sourced from our `user_role` / `user_scope` tables.                                   |
| Credential issue on approval | `auth.admin.inviteUserByEmail()` / `generateLink()` — an activation link, never a password. Matches the rule in [05 §5.1](../architecture/05-security.md). |
| Forced first-login change    | `app_user.must_change_password`, surfaced as a JWT claim; `proxy.ts` redirects and every use case except change-password rejects the actor.                |
| MFA                          | Supabase Auth MFA (TOTP), with AAL2 required for privileged roles.                                                                                         |
| Password policy              | GoTrue minimum length + leaked-password protection, plus our own history check on change.                                                                  |
| Lockout                      | GoTrue rate limiting, plus our `user_login_attempt` record for the audit and governance reports.                                                           |
| Revocation                   | `auth.admin.signOut(userId, 'global')` revokes refresh tokens. See the window caveat below.                                                                |
| Auth audit                   | `auth.audit_log_entries` plus our own `audit_log` events.                                                                                                  |

### The revocation window — stated plainly

JWTs are self-contained. A revoked user keeps a working access token until it expires. Mitigations,
all applied:

1. **Access token TTL set to 5 minutes** (default is 3600s). Refresh is transparent to the user;
   the cost is more refresh traffic, which is negligible at this user count.
2. **`requireActor()` re-reads `app_user.status`** from the database on every request. Because the
   Data Access Layer is already the single resolution point and is wrapped in React `cache()`, this
   costs one indexed lookup per render pass. A suspended user is therefore blocked immediately,
   regardless of token validity.
3. Sensitive use cases (`stock:adjust`, `dispatch:*`, `admin:*`) additionally re-check the live
   permission set rather than trusting the claim.

Net effect: revocation is effectively immediate for our application, and the 5-minute window applies
only to anything reading the JWT without touching the database — which, by rule, is only `proxy.ts`'s
optimistic redirect.

### Claim staleness

Custom claims are refreshed when the token refreshes. A role change therefore takes up to one token
lifetime to appear in the JWT. This is why authorization decisions are made in the use case against
the database ([0011](0011-authorization-model.md)) and the claims are used for optimistic UI and RLS
scoping only. `permissions_version` in the claim lets the DAL detect a stale token and force a
refresh when it matters.

## Consequences

**Positive**

- `auth.uid()` works in RLS with no adapter, which is what makes [0005](0005-postgres-rls-as-defence-in-depth.md)
  materially stronger under Supabase than it was under the custom design.
- Password reset, email verification, MFA enrolment and rate limiting are maintained by someone else.
- Invite-by-link is exactly the credential-issue flow M04 requires, with no plaintext password
  anywhere.
- One identity system. No reconciliation job, no drift.

**Negative**

- Less control over the session lifecycle than [0010](0010-custom-session-auth.md) offered; the
  revocation window has to be engineered around rather than being absent by construction.
- GoTrue's email templates must be styled to EthioStar's identity, and its transactional email
  needs a real SMTP provider configured (the built-in sender is rate-limited and not for production).
- Vendor coupling on the most security-sensitive component. Contained: `auth.users` is a small
  surface, and our `app_user` profile carries everything domain-specific.
- Supabase Auth is a hosted dependency; if self-hosting is chosen, GoTrue becomes ours to run.

## Alternatives rejected

- **Custom sessions ([0010](0010-custom-session-auth.md)) on top of Supabase.** Would require either
  abandoning `auth.uid()` RLS or synthesising fake JWT claims to satisfy it — maintaining a second
  identity system to impersonate the first. Strictly worse.
- **Supabase Auth for customers, custom for staff.** Two systems, two audit trails, two revocation
  paths, and RLS that behaves differently depending on who is asking. The `actor_kind` claim achieves
  realm separation within one system.
- **External IdP via Supabase SSO.** No federation requirement today. Available later without
  redesign, which is itself an argument for GoTrue now.
