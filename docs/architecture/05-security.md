# 5. Security, Authentication and Authorization

M01 is not an IT convenience. From the client document: _"it is the control that stops an
unauthorised person from adjusting a stock balance or releasing another customer's coffee."_

---

## 5.1 Authentication

### Approach

**Supabase Auth (GoTrue).** Rationale and the full requirement mapping in
[adr/0014-supabase-auth.md](../adr/0014-supabase-auth.md). The short version: RLS policies key on
`auth.uid()`, so a custom session system would mean maintaining a second identity system whose only
purpose is to impersonate the first.

`auth.users` is the identity store. Our `public.app_user` profile table carries the domain
attributes (realm, status, `must_change_password`, employee details, scope) with `id` as a foreign
key to `auth.users(id)`. **We never add columns to `auth.users`** — it is Supabase-owned and upgraded
underneath us.

### Session model

- **JWT access token + refresh token**, managed by GoTrue, stored in cookies by
  `@supabase/ssr` and read server-side.
- **Access token TTL: 5 minutes** (default 3600). This is deliberate — see revocation below.
- Refresh rotation on, reuse detection on.
- Cookies: `httpOnly`, `secure`, `sameSite: 'lax'`. Configure the Supabase client for cookie-based
  storage so the token is never in `localStorage`, which is XSS-readable.
- Realm separation via the `actor_kind` claim, not by separate user pools.

### Custom claims

A `public.custom_access_token_hook(event jsonb) returns jsonb` injects, on every token issue and
refresh:

```
actor_kind           'staff' | 'customer'
customer_id          for portal users — used directly by RLS policies
role                 primary role code
scope                { kind, ids[] } for staff data scoping
must_change_password boolean
permissions_version  integer — bumped when a role's permission set changes
status               'active' | 'suspended'
```

Granted `EXECUTE` to `supabase_auth_admin`, revoked from `authenticated`, `anon` and `public`.
Registered under Authentication → Hooks.

Claims are for **RLS scoping and optimistic UI only.** Authorization decisions are made in the use
case against the database ([adr/0011](../adr/0011-authorization-model.md)), because a claim can be up
to one token lifetime stale.

### Revocation — the one real trade-off

A JWT is self-contained: a revoked user holds a valid token until it expires. Three mitigations,
all applied:

1. **5-minute access token TTL.** Refresh is transparent; the extra traffic is negligible at this
   user count.
2. **`requireActor()` re-reads `app_user.status` on every request.** The DAL is already the single
   resolution point and is wrapped in React `cache()`, so this is one indexed lookup per render pass.
   A suspended user is blocked immediately, regardless of token validity.
3. `auth.admin.signOut(userId, 'global')` revokes refresh tokens, closing the session for good.

Net effect: revocation is effectively immediate everywhere except `proxy.ts`'s optimistic redirect,
which by design touches no database.

### Password policy

- GoTrue handles hashing (bcrypt) and its own rate limiting. Configure: minimum length 12, required
  character classes, and **leaked-password protection on** (HaveIBeenPwned k-anonymity).
- `user_password_history` (ours) keeps the last 5 hashes; reuse is rejected in the change-password
  use case.
- **Forced first-login change** — the M04 requirement. `app_user.must_change_password` is set at
  credential issue, surfaced as a JWT claim; `proxy.ts` redirects to `/first-login` and every use
  case except change-password rejects an actor carrying the flag.
- Account lockout: GoTrue rate-limits authentication attempts. We additionally record every attempt
  in `user_login_attempt` with IP — required for the governance reports and the audit trail, which
  GoTrue's own logs do not satisfy on their own.

### MFA (TOTP)

Supabase Auth MFA. **Mandatory for** System Administrator, General Manager, Finance Officer and any
role holding `stock:adjust`; optional otherwise. Enforced by requiring `aal2` in the JWT for those
roles — checked in `requireActor()` and mirrored in RLS policies for the most sensitive tables.
Recovery codes are handled by GoTrue. Included in Phase 1 because the roles that can move stock or
release coffee are exactly the ones worth protecting, and retrofitting MFA onto a live user base is
disruptive.

### Credential issue on approval (Stage 1 requirement)

```
ApplicationApproved
  → customers.createFromApplication()
  → auth.admin.inviteUserByEmail(email, { data: { actor_kind: 'customer', customer_id } })
      GoTrue creates the auth.users row and emails a single-use activation link
  → app_user profile row created with must_change_password = true
  → printing: registration certificate + credential letter PDF for the file
```

**No password is ever generated, stored, logged or emailed** — the invitation carries a link and the
customer sets their own. This is what the M04 requirement should mean; emailing a password puts a
working credential in a mailbox forever.

GoTrue's email templates must be restyled to EthioStar's identity, and a real SMTP provider
configured — the built-in sender is rate-limited and explicitly not for production.

---

## 5.2 Authorization

### Permission model

A permission is `<resource>:<action>` — the document's own definition: _"a specific action on a
specific object, such as 'approve delivery request' or 'post stock adjustment'."_

```
customer_application:view|review|verify_document|approve|reject
customer:view|create|update|suspend|manage_documents
delivery_request:view|create|approve|reject|cancel
goods_receipt:view|create|confirm_count|record_weight|witness_weight
store_placement:create|transfer
stock:view|adjust|count|approve_count_variance
warehouse:view|manage|set_thresholds
kesha:view|manage_empty_stock|reconcile
processing_request:view|create|approve
appointment:view|schedule|reschedule|cancel
job_order:view|accept|start|record_output|close|close_with_variance|override_schedule
acceptance:view|issue|sign_on_behalf
release_request:view|create|approve
dispatch:view|schedule|load|issue_gate_pass|record_gate_out
labour:view|manage_gangs|manage_rates|approve_earnings|issue_voucher
document:print|reprint
audit:view|export
admin:manage_users|manage_roles|manage_master_data|manage_settings|manage_numbering|impersonate
report:view_operational|view_financial|export
```

The catalogue lives in **code** (`db/seeds/010-permissions.ts`) and is synced to the database on
every deploy. Roles → permissions live in the **database** and are editable by an administrator
(M23). That split means a new permission can never be missing in production, while
who-can-do-what remains configurable without a release.

### The twelve roles

System Administrator, General Manager, Operations Manager, Customer Service Officer, Store Keeper,
Store Manager, Production Operator, Finance Officer, Labour Coordinator, Security/Gate Officer,
Auditor (read-only), Customer. Seeded with sensible defaults in `db/seeds/020-roles.ts`; EthioStar
adjusts them in the admin console.

`Auditor` is granted only `*:view` and `audit:*`. Enforce that with a test asserting the Auditor
role holds no permission whose action is outside a read allow-list — an auditor silently gaining
write access is a governance failure that would otherwise go unnoticed.

### Data scoping

_"a store keeper of Room A cannot post movements in Room B."_

```ts
type Scope =
  | { kind: 'global' }
  | { kind: 'branch'; branchIds: BranchId[] }
  | { kind: 'warehouse'; warehouseIds: WarehouseId[] }
  | { kind: 'room'; roomIds: RoomId[] }
  | { kind: 'customer'; customerId: CustomerId } // portal users
```

Stored in `user_scope`. Resolved once per request in `server/auth/scope.ts` and carried on the
`Actor`. Two enforcement points, both required:

1. **Command side** — `requirePermission(actor, 'store_placement:transfer', { roomId })` fails if
   the room is outside scope.
2. **Query side** — every repository read takes the actor's scope and adds the predicate. A query
   builder helper (`applyScope(qb, actor)`) makes the correct thing the easy thing.

### The single decision point

```ts
// src/server/auth/authorize.ts
export async function requirePermission(
  actor: Actor,
  permission: PermissionCode,
  target?: ScopeTarget,
): Promise<void>
```

- **Deny by default.** No permission → `ForbiddenError`.
- Called at the top of **every** use case that writes, and every read of another party's data.
- Every denial is written to `audit_log` with the attempted permission and target. Repeated denials
  by one actor are a signal worth having (and feed the Phase 3 M27 risk monitor for free).
- A lint rule requires that every file matching `*.usecase.ts` contains a call to
  `requirePermission` or an explicit `// authz: public — <reason>` comment. Cheap, and it makes the
  omission visible in review rather than in an incident.

`useMemo`-style client-side permission checks (`usePermission()` in `src/ui/hooks`) exist **only** to
hide UI. They are never the control.

### Server Action authorization

Restating because it is the most commonly missed thing in App Router codebases, and the Next.js
security guide is explicit about it: a Server Action is a POST endpoint reachable directly. The
`page.tsx` that renders the button is not a guard. **Every action re-authorizes.** `withAction()`
makes this structural — it resolves the actor and refuses to invoke a handler that has not declared
a required permission.

### Object-level authorization (IDOR)

Permission alone is insufficient: a customer with `delivery_request:view` must not view _another
customer's_ request. Every fetch-by-id in a use case is followed by an ownership/scope assertion
before anything is returned. The `assertAccessible(actor, entity)` helper centralises the pattern,
and the integration test suite includes a systematic "cross-tenant probe": for each customer-facing
route, request another customer's resource id and assert 404 (not 403 — a 403 confirms the id
exists, which is itself a leak).

---

## 5.3 Input validation

- **Zod at every boundary.** Server Actions parse `FormData`; route handlers parse JSON; both reject
  unknown keys (`.strict()`) — this kills mass assignment.
- **Domain re-validates.** The interface schema checks shape; the domain checks meaning
  (`Weight.fromKg()` refuses negatives and >3 decimal places regardless of what the schema allowed).
- **Never trust `searchParams`, path params, hidden fields or client-supplied ids** to imply
  authority. Re-derive authority from the session every time.
- File uploads: extension allow-list **and** magic-byte sniffing (they disagree more often than you
  would like), size cap (`10 MB` default, configurable), filename sanitised and never used as a
  storage key (keys are `{uuid}/{sha256}`), `Content-Disposition: attachment`, and a strict
  `Content-Security-Policy: sandbox` on the download route.
- Uploads are quarantined until `file_scan_result` is `CLEAN`; a `PENDING` or `INFECTED` file cannot
  be attached to an application or downloaded. This is the M05 key control, honoured in Phase 1.

---

## 5.4 Transport and headers

Set in `proxy.ts`:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), geolocation=(), microphone=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{n}' 'strict-dynamic';
                         style-src 'self' 'nonce-{n}'; img-src 'self' data: blob:;
                         object-src 'none'; base-uri 'none'; frame-ancestors 'none';
                         form-action 'self'
```

`camera=(self)` because M22's QR scanning (Phase 2) needs it and the policy should not have to change
for that.

Note the trade-off documented in the Next.js CSP guide: a nonce forces dynamic rendering. Acceptable
here — this application is dynamic by design (§1.6). Static marketing pages under `(public)` use a
hash-based policy instead so they stay prerenderable.

**CSRF:** Server Actions are POST-only and Next.js compares `Origin` against `Host`. Behind a reverse
proxy set `serverActions.allowedOrigins` and ensure `X-Forwarded-Host` is set correctly, or every
action will be rejected in production while working perfectly in development. Route handlers that
mutate additionally require a double-submit token.

---

## 5.5 Rate limiting

Postgres-backed fixed-window + token-bucket limiter (`platform/ratelimit`). No Redis dependency for
the expected load; the port allows swapping later.

| Surface                              | Limit                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `POST /api/v1/applications` (public) | 3/hour/IP, 10/day/IP, plus a honeypot field and a time-to-complete floor |
| Login                                | 10/15min/IP, plus per-account lockout (§5.1)                             |
| Password reset request               | 3/hour/account, 10/hour/IP                                               |
| File upload                          | 20/hour/user, 100 MB/day/user                                            |
| PDF generation                       | 30/min/user                                                              |
| Authenticated mutations (default)    | 120/min/user                                                             |
| Read endpoints                       | 600/min/user                                                             |

Responses use `429` with `Retry-After`. Limits are settings, not constants.

---

## 5.6 Secrets and key management

- No secret in the repository. `.env.example` documents names and shapes only.
- Production secrets from the orchestrator's secret store, injected as environment variables.
- **`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` must be set explicitly** and identical across instances
  once more than one application instance runs — otherwise Server Actions fail intermittently, in a
  way that is genuinely hard to diagnose. Generate with `openssl rand -base64 32`. This is the
  single most commonly missed item when a Next.js app is first scaled out.
- Field-level encryption (AES-256-GCM, `platform/crypto`) for customer bank account numbers and TOTP
  secrets, with a documented key-rotation procedure and a `key_version` column so rotation does not
  require re-encrypting everything at once.
- Logs are redacted by an allow-list, not a deny-list: the logger serialises known-safe fields and
  drops the rest. A deny-list misses the field somebody adds next month.

---

## 5.7 Threat register

| #   | Threat                                               | Impact                                         | Mitigation                                                                                                                                                               |
| --- | ---------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | Customer reads another customer's stock              | Contractual breach, reputational               | Explicit query scoping + RLS + cross-tenant probe tests + 404-not-403                                                                                                    |
| T2  | Staff adjusts a stock balance to conceal loss        | Direct financial loss                          | `stock:adjust` is a distinct permission; adjustments require a reason code; ledger is append-only; adjustment exception report; (P3) M27 anomaly detection               |
| T3  | Coffee released without acceptance or against a hold | Loss of a third party's asset                  | Clearance checks in the dispatch use case; gate pass required and single-use; gate-out records the scan                                                                  |
| T4  | Gate pass forged or reused                           | Asset walks out                                | Numbered, QR-tokenised with an unguessable token, single-use, status transitions to `USED` at gate-out inside a transaction                                              |
| T5  | Weight altered after the fact                        | Dispute becomes unwinnable                     | Weighing records are append-only; corrections are new rows referencing the original; before/after audit capture                                                          |
| T6  | Privilege escalation via self-role-assignment        | Full compromise                                | `admin:manage_roles` cannot be granted to oneself; role changes require a second administrator (maker-checker) and are audited                                           |
| T7  | Malware uploaded via KYC documents                   | Endpoint compromise                            | Magic-byte check, allow-list, ClamAV quarantine, no execution path, sandboxed download                                                                                   |
| T8  | Session hijack                                       | Account takeover                               | httpOnly+secure+SameSite, rotation on privilege change, idle+absolute timeout, session list & revoke, IP/UA change flagged                                               |
| T9  | Public application form abused                       | Spam, resource exhaustion                      | Rate limit + honeypot + size caps + no unauthenticated file storage until the application record exists                                                                  |
| T10 | CSV formula injection in exports                     | Attacker code runs on a manager's laptop       | Prefix `= + - @ \t \r` with `'` in `core/validation/sanitize.ts`; applied by the single export helper                                                                    |
| T11 | Enumeration of consignment ids via QR/URLs           | Information disclosure                         | UUIDv7 ids are unguessable; QR carries a separate random token, revocable independently                                                                                  |
| T12 | RLS bypass via connection reuse                      | Cross-tenant leak                              | Transaction-scoped `set_config` + `set local role`; dedicated interleaved-transaction test under Supavisor pooling                                                       |
| T16 | **`service_role` used as the default connection**    | RLS becomes decorative across the whole system | Confined to three sanctioned uses; single non-exported factory; CI allow-list on import sites ([adr/0013](../adr/0013-supabase-as-database-platform.md))                 |
| T17 | Service-role key leaked to the browser bundle        | Total compromise — it bypasses every policy    | Only `NEXT_PUBLIC_SUPABASE_URL` and the anon key are client-side; CI greps the built bundle for the service key pattern                                                  |
| T18 | A new table ships without RLS enabled                | Readable by anyone holding the anon key        | Migration `0021` enables + `FORCE`s RLS on every `public` table; CI fails if any table lacks a policy                                                                    |
| T19 | Stale JWT claim grants access after a role change    | Privilege persists up to one token lifetime    | Authorization decided in the use case against the DB, never from the claim; `permissions_version` forces a refresh                                                       |
| T20 | Public Storage bucket                                | Customer documents world-readable by URL       | All buckets private; access only via short-lived signed URLs from our authorized route handler                                                                           |
| T13 | Migration or script mutates the audit log            | Loss of evidential value                       | Append-only triggers, `REVOKE`, separate migrator role, CI check that no migration touches audit tables                                                                  |
| T14 | Insider prints another customer's documents          | Confidentiality breach                         | Print goes through a use case with scope check; every render is recorded in `printed_document` with the actor                                                            |
| T15 | Support impersonation abused                         | Trust failure                                  | Impersonation requires `admin:impersonate`, is time-boxed, is banner-visible in the UI, cannot perform write actions, and writes a distinct audit event on start and end |

---

## 5.8 Audit requirements (M07)

Two complementary mechanisms, both written in the business transaction:

1. **`audit_log`** — generic row-level capture via a database trigger: table, row id, operation,
   before/after JSONB diff, actor, timestamp, IP, user agent, request id. Catches everything,
   including changes made by a path someone forgot to instrument.
2. **`domain_event`** — semantic business events with typed payloads. Meaningful to a human and to
   Phase 3.

The trigger reads the actor from `coalesce(auth.uid()::text, current_setting('app.actor_id', true))`
— `auth.uid()` on the authenticated path, and the explicitly-set system actor on the worker's
service-role path. If both are unset the trigger raises, so an un-attributed write is impossible
rather than merely discouraged. That is a direct implementation of the M01 key control:
_"Every action in the system is attributable to a named user; no shared or generic operational
accounts are permitted."_

Also audited, because the document's governance report list asks for them: login success/failure,
logout, permission denial, role and permission changes, configuration changes (old → new value),
document prints and reprints, impersonation start/end, data exports, and failed authorization
attempts.
