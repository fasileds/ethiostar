# 9. Operations and Deployment

The database, auth and storage are **Supabase**. The Next.js app and the worker are deployed by us.

> **Open decision — hosted or self-hosted Supabase.** Both satisfy the requirement; see
> [adr/0013](../adr/0013-supabase-as-database-platform.md). This chapter is written for **Supabase
> Cloud**, with the self-hosted deltas marked ⓢ. The application code is identical; only environment
> variables and these runbooks differ.
>
> The decision turns on one question: **can the plant tolerate the gate and receiving screens going
> down when its internet link does?** During peak intake, probably not. Measure real latency and link
> reliability from the plant before committing production. Decide by roadmap Step 24.

---

## 9.1 Environments

| Environment  | Purpose                            | Supabase                                                               | Who deploys                     |
| ------------ | ---------------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| `local`      | Development                        | `supabase start` — full stack in Docker                                | anyone                          |
| `test`       | CI                                 | ephemeral local Supabase, or Testcontainers Postgres for pure DB tests | CI                              |
| `preview`    | Per-PR review                      | Supabase **branch** (ephemeral project, migrations auto-applied)       | CI on PR                        |
| `staging`    | UAT, training, migration rehearsal | dedicated project, anonymised production copy                          | CI on merge to `main`           |
| `production` | Live                               | dedicated project                                                      | tagged release, manual approval |

**Separate Supabase projects for staging and production.** Not separate schemas in one project —
auth, storage and the role model are project-scoped, so sharing a project means sharing users and
buckets, and a staging mistake reaches real customers.

**Staging must be schema-identical to production and refreshed from an anonymised production dump on
a schedule.** A migration rehearsed against a fresh database proves nothing about the migration that
will run against four million ledger rows. The anonymiser must scrub `auth.users` emails too, or
staging will email real customers during a test.

`supabase/config.toml` is committed and is the mechanism that keeps auth settings (JWT expiry,
password policy, redirect URLs, SMTP) identical across environments. Configuring auth through the
dashboard instead is the same class of mistake as changing schema there.

---

## 9.2 Runtime topology

```
                    ┌────────────────────────────┐
   Internet ──TLS──►│  nginx / Caddy             │  TLS termination, HSTS, gzip/brotli,
                    │  reverse proxy             │  X-Forwarded-* , static caching, IP allow-list
                    └────────┬───────────────────┘  on /api/internal/*
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
   ┌────────────────────┐        ┌────────────────────┐        ┌──────────┐
   │ app  (next start)  │  …xN   │ worker (node)      │  …xN   │ ClamAV   │
   │ 3000               │        │ no HTTP surface    │◄──────►│          │
   └─────────┬──────────┘        └─────────┬──────────┘        └──────────┘
             │ 6543 (txn pool)             │ 5432 (session pool)
             │ role: authenticated         │ role: service_role
             └──────────────┬──────────────┘
                            ▼
        ╔═══════════════════════════════════════════════════╗
        ║  SUPABASE                                         ║
        ║  ┌───────────┐ ┌────────┐ ┌─────────┐ ┌────────┐  ║
        ║  │ Supavisor │►│Postgres│ │ GoTrue  │ │Storage │  ║
        ║  │  pooler   │ │  +RLS  │ │  auth   │ │private │  ║
        ║  └───────────┘ └────────┘ └─────────┘ └────────┘  ║
        ║                  ▲ pg_cron → job_queue            ║
        ╚═══════════════════════════════════════════════════╝
```

App and worker share one image, differing only in entrypoint (`next start` vs
`node dist/worker/main.js`). Same code, same migrations, same config — no drift between what the web
tier believes and what the worker believes.

**Note the two different connections.** The app uses the transaction pooler (6543, `prepare: false`)
and connects as `authenticated` with per-transaction JWT claims so RLS applies. The worker uses the
session pooler as `service_role`, because it has no user context — one of the three sanctioned uses
in [adr/0013](../adr/0013-supabase-as-database-platform.md). Getting these the wrong way round
disables RLS for the entire web tier, silently.

ⓢ **Self-hosted:** the Supabase box becomes a Docker Compose stack you run (Postgres, GoTrue,
PostgREST, Storage, Supavisor, Kong). Same interfaces, same code. You take on backups, PITR and
upgrades, and you lose preview branches.

### `next.config.ts`

```ts
const nextConfig: NextConfig = {
  output: 'standalone', // small production image, no node_modules copy
  typedRoutes: true, // stable in Next 16 — catches broken links at build time
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ['postgres', '@react-pdf/renderer'],
  experimental: {
    serverActions: { allowedOrigins: [/* production host + any proxy host */] },
  },
  images: { remotePatterns: [] }, // no remote images; deprecated `domains` is not used
}
```

`serverActions.allowedOrigins` is mandatory behind a reverse proxy. Without it, Next's Origin/Host
comparison rejects every Server Action in production while everything works locally — a failure mode
that costs an afternoon the first time.

`cacheComponents` stays **off**. This is an operational system where stale data is a liability
(§1.6).

---

## 9.3 Deployment procedure

Zero-downtime, and it depends entirely on the expand/contract migration discipline in §4.6.

```
1  Tag a release.  CI builds and pushes an immutable image tagged with the git SHA.
2  Back up:  confirm the Supabase PITR window covers now; take an on-demand backup.
3  supabase db push  — applies migrations over the DIRECT connection, before new code rolls.
       Additive-only by construction, so the running old code is unaffected.
4  supabase db diff --linked  → must report NO difference. A difference means someone
       changed schema in the dashboard; stop and reconcile before continuing.
5  Roll the app instances one at a time; readiness probe gates each.
6  Roll the workers.  (Workers drain: SIGTERM → stop claiming → finish in-flight → exit.)
7  Run seeds (idempotent) — syncs the permission catalogue and templates.
8  Smoke test: login, portal dashboard, a GRN PDF render, an outbox drain, a signed-URL download.
9  Watch cpms_outbox_lag_seconds and the error rate for 15 minutes.
```

Step 4 is not ceremony. Supabase makes dashboard schema editing one click away, and the drift it
creates is invisible until a migration fails on production and not on staging.

**Rollback:** redeploy the previous image. The schema is forward-compatible by design, so a code
rollback needs no schema rollback — which is the entire reason for the expand/contract rule.

**Version skew:** during a rolling deploy two versions serve traffic simultaneously. Next.js handles
client/server skew for its own assets; set `deploymentId` in `next.config.ts` so stale clients get a
clean reload rather than a mismatched RSC payload.

---

## 9.4 Backup and recovery

|                        | Target                                                                  | Provided by                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPO                    | 5 minutes                                                               | Supabase **PITR** — a paid add-on that must be explicitly enabled. Daily backups alone give a 24-hour RPO, which is not acceptable for a custody record. |
| RTO                    | 2 hours                                                                 | Restore to a new project + repoint `DATABASE_URL`                                                                                                        |
| Full backup            | nightly, retained 30 days                                               | Supabase automated backups                                                                                                                               |
| **Independent export** | nightly `pg_dump -Fc` to storage **outside Supabase**, retained 90 days | **Ours.** Do not rely solely on the provider holding the only copy of an evidential record. This is the item most often skipped.                         |
| Auth data              | included in the dump — `auth.users` is in the database                  | verify explicitly; a restore that loses logins is not a restore                                                                                          |
| Storage objects        | nightly sync of the bucket to independent storage                       | **Ours.** Supabase Storage is not covered by the database backup.                                                                                        |
| Restore drill          | monthly, documented, timed                                              | ours                                                                                                                                                     |

Two Supabase-specific traps:

1. **Storage objects are not in the database backup.** A database-only restore gives you
   `stored_file` rows pointing at objects that no longer exist. Back up the bucket separately and
   test restoring both together.
2. **PITR is opt-in.** Assuming it is on because "Supabase does backups" is a 24-hour data-loss
   surprise. Verify it in the dashboard and record the check in the restore runbook.

ⓢ **Self-hosted:** PITR means configuring WAL archiving yourself (`wal-g` or `pgBackRest`), and the
storage volume needs its own backup. Budget this properly — it is the main operational cost of
self-hosting.

`ops/runbooks/restore.md` must be written in Phase 1, not deferred. An untested backup of a custody
system's audit trail is a compliance problem, not just an ops problem.

**Retention:** the audit trail and domain events are retained for the statutory period EthioStar
specifies (assume 10 years pending confirmation). Because both are append-only, retention means
partitioning by year and moving cold partitions to cheaper storage — not deleting. Partition
`audit_log`, `domain_event` and `stock_movement` by `RANGE (occurred_at)` monthly from day one:
partitioning an empty table is free; partitioning a table with 50 million rows is an outage.

---

## 9.5 Monitoring and alerting

**Alert on symptoms the business feels, not on machine noise.**

| Alert                       | Condition                             | Severity          |
| --------------------------- | ------------------------------------- | ----------------- |
| Notifications not going out | `cpms_outbox_lag_seconds > 300`       | page              |
| Jobs dying                  | `job_queue` DEAD count increases      | page              |
| Ledger drift                | reconciliation job finds any mismatch | page              |
| Database unreachable        | readiness probe failing 2 min         | page              |
| Error rate                  | 5xx > 1% over 5 min                   | page              |
| Capacity critical           | any room > 95% occupied               | ticket (business) |
| Mass-balance exceptions     | > 5 in a day                          | ticket (business) |
| Authorization denials       | > 20/hour for one actor               | ticket (security) |
| Disk                        | > 80%                                 | ticket            |
| Certificate expiry          | < 21 days                             | ticket            |
| Slow queries                | p95 > 2 s on the portal stock view    | ticket            |

Health endpoints:

- `/api/internal/health` — liveness. Process is up. No dependencies checked, so a database blip does
  not trigger a restart loop.
- `/api/internal/ready` — readiness. Database, object storage and queue reachable. Gates traffic.
- `/api/internal/metrics` — Prometheus. IP-restricted at the reverse proxy.

---

## 9.6 Local development

```bash
supabase start                                       # full Supabase stack in Docker
docker compose -f ops/docker-compose.dev.yml up -d   # clamav (not part of Supabase)
cp .env.example .env.local                           # keys printed by `supabase start`
npm install
supabase db reset                                    # apply all migrations from scratch
npm run db:seed
npm run dev            # app
npm run dev:worker     # worker, separate terminal
```

- `supabase start` gives real GoTrue, Storage and Postgres locally, so auth and signed-URL behaviour
  match production instead of being stubbed. This is the single biggest practical benefit of the
  platform for development.
- **Inbucket** (bundled with `supabase start`, at `:54324`) catches all outbound auth email — the
  credential-issue and delay-notification flows are inspectable without sending anything. No separate
  Mailpit needed.
- `supabase db reset` is the fast way to prove migrations apply cleanly from zero. Run it before
  every push; it is the same check CI runs.
- `npm run seed:demo` creates a realistic season: customers, consignments across every lifecycle
  state, jobs with yields, ageing stock. This is what makes UI and performance problems visible
  before UAT.
- Windows note: the team here develops on Windows. Keep `core.autocrlf` consistent, run the
  containers under WSL2 for sane volume performance, and ensure `scripts` in `package.json` avoid
  shell-specific syntax (no `&&`-chained POSIX-only commands where a cross-platform runner will do).

---

## 9.7 Operational runbooks to write during Phase 1

Not after. Each is short; the value is that the answer exists at 2 a.m.

1. `restore.md` — restore to a point in time, and how to verify.
2. `stuck-outbox.md` — diagnose and drain; how to safely replay a dead-lettered notification.
3. `ledger-drift.md` — what to do when reconciliation reports a mismatch. (Rebuild the projection;
   never edit the ledger.)
4. `failed-migration.md` — assess, roll forward, when to restore.
5. `locked-out-admin.md` — break-glass procedure, and how it is audited.
6. `capacity-full.md` — the operational, not technical, escalation path.
7. `gate-pass-dispute.md` — how to produce the evidence trail for a contested departure.
8. `user-offboarding.md` — revoke sessions (`auth.admin.signOut(id, 'global')`), suspend
   `app_user.status`, reassign scopes, preserve the audit record.
9. `supabase-outage.md` — what the plant does when the link or the platform is down. **Write this
   one first if production is hosted**, because it is the operational consequence of the decision in
   §9.0 and the business needs an answer before go-live, not during.
10. `schema-drift.md` — someone changed schema in the dashboard: how to detect, capture with
    `supabase db diff`, and reconcile into a migration.

Items 3, 7 and 9 are the ones that justify the whole architecture; make sure they can actually be
answered before go-live.
