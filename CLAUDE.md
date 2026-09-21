# Finance Finder

Multi-market personal portfolio tracker. Next.js 16 (App Router) on Vercel,
Supabase (Postgres + RLS), pnpm, TypeScript strict, decimal.js for money, zod
for validation, vitest + fast-check for tests.

@AGENTS.md

## Design documents (root)

| Doc | Owns |
|---|---|
| `PACKS.md` | **architecture**: market-pack model, kernel/pack boundary, schema changes for multi-country, conformance gates, governance |
| `ARCHITECTURE.md` | **features & principles**: scope (no tax/fiscal, no brokers), the nine invariants (§4.9 = privacy posture), data flow, glossary |
| `SPEC.md` | **features**: calculation formulas, ingestion/snapshot behaviour, the ten screens, design system, edge cases; §2–3 mirror the migration |
| `MILESTONES.md` | Delivery order and production-data safety gate. PACKS.md §14: `packs/br` from the first commit, canary `packs/uk` + conformance as Milestone 4 |

### Document precedence

`PACKS.md` was written after `ARCHITECTURE.md`/`SPEC.md`, once the project
became multi-country and open-source; the code was scaffolded from it.

- **Architecture, schema shape, multi-country, contribution model** →
  `PACKS.md` + the code it produced (`supabase/migrations/`, `packs/types.ts`,
  `packs/schema.ts`, `packs/conformance/`) win.
- **What the product does** (scope, calculations, screens, design, edge cases)
  → `ARCHITECTURE.md` and `SPEC.md` win.
- The installed stack (`package.json`) beats any version pinned in prose.

The root `SPEC.md` is the technical spec. `specs/SPEC.md` and
`specs/PERSONAS.md` are the QA-system user-story templates (still unfilled) —
keep them distinct.

## The one rule (PACKS.md §1)

**Packs supply data, identifiers and mappings. Packs never supply math.**
Valuation strategies (§5) and series kinds (§6) are closed unions in
`packs/types.ts`. A pack that cannot be expressed with them is a kernel
discussion, not a pack workaround. Two packs needing the same missing strategy
is the threshold for adding one.

## Layout

```
packs/            market packs (data + mappings). types.ts/schema.ts/index.ts are KERNEL-owned
  br/ global/     one dir per pack: index.ts manifest, calendar, instruments, series, sources/, fixtures/, README.md
  conformance/    `pnpm test:packs` — the merge gate for pack PRs (PACKS.md §11)
lib/calc/         kernel math, pure functions (TWR, MWR, valuation, series returns, FX, golden runner)
lib/packs/        kernel pack runtime: PackHttp impl (rate limit/retry/fixtures), activation, ingest job
lib/auth/         identity: access decision, DAL (`requireUser`), security writes
lib/ledger/       the ledger behind RLS: text-cast readers, zod schemas, typed-result writes
lib/jobs/         after-response work under the service role: ingest wrappers, snapshot job, delete
lib/csv/ lib/import/  RFC 4180 reader/writer; column map, dry run, commit planner
lib/backup/       backup v1 schema, deterministic serializer, restore planner
lib/supabase/     public env, cookie server client, paginate; service.ts (cron + lib/jobs only)
lib/settings/     INSTANCE_DEFAULTS — the ONLY literal site for a pack id, currency or locale (Milestone 4)
lib/copy/         UI copy dictionaries, en + pt-BR, one Copy type (Milestone 4)
lib/format/       money/quantity/percent/date formatting FROM DECIMAL STRINGS, never a float (Milestone 4)
proxy.ts          session refresh + optimistic redirects (Next 16 proxy)
app/              Next.js routes. app/(app)/* data pages; app/login/*; app/auth/callback; app/api/cron/* = the only two crons
app/(app)/_charts/  the ONE place a decimal string becomes a number (a chart coordinate) — Milestone 4
supabase/         config + migrations. Packs ship ZERO migrations.
scripts/          generate-codeowners.ts (CODEOWNERS is generated — never hand-edit)
```

## Commands

```
pnpm dev                 # Next.js
pnpm typecheck           # next typegen && tsc
pnpm lint                # ESLint; bans fetch/axios/lib imports inside packs/
pnpm test                # all vitest
pnpm test:calc           # lib/calc only — the suite that catches financial bugs
pnpm test:packs          # conformance suite only
pnpm test:db             # *.dbtest.ts against local Supabase; FAILS (never skips) without the stack
pnpm codeowners          # regenerate .github/CODEOWNERS from manifests
pnpm db:start / db:reset # local Supabase (Docker)
```

## Non-negotiables

- Money and rates are `decimal.js` in the kernel and **decimal strings** at
  every boundary (pack `FetchResult`, JSON fixtures). Never `parseFloat`, never
  a JS `number` for a value. Rate strings use unit form (`"0.12"` = 12%), never
  upstream percentage points. Yield-curve points carry `tenorDays`.
- `series_points` and `ingest_cursors` have NO `user_id` and NO RLS by design.
  Access control is by grants: writes revoked from `anon`/`authenticated`, so
  only cron (service role) writes. Do not "fix" it by adding RLS.
- Packs never import from `lib/`, never add npm deps, never use global `fetch`.
  Lint and the conformance suite both enforce this.
- `transactions` and `portfolio_snapshots` are never touched by pack work.
- Logs carry ids, counts, status codes, durations — **never row values, never
  a full pack URL** (brapi's token is a query param). No analytics, telemetry
  or error-reporting SaaS by default; fonts via `next/font`, never a CDN. Auth
  reads identity with `getUser()`, never `getSession()`. SPEC §12.
- No tax or fiscal reporting features, ever (ARCHITECTURE §2).
- Two Vercel crons by design (not a platform cap). Ingestion iterates sources inside one invocation
  with a per-source time budget and `ingest_cursors` resume markers.
- Cron auth uses `lib/cron/auth.ts` and fails closed unless `CRON_SECRET` is at
  least 32 bytes. Never inline an environment-string comparison in a route.
- `pnpm release:check` must pass before real portfolio data is entered. Green
  scaffold CI is not a production-readiness signal.
- `PACK_API_VERSION` bump ⇒ same PR updates every in-repo pack.

## Adding a pack (contributor path)

1. `packs/<id>/index.ts` exporting a `MarketPack`; register in `packs/index.ts`.
2. Every id prefixed `<id>.`; sources' `license` from `packs/LICENSES.md`.
3. Adapters use only `ctx.http`; return decimal strings.
4. Record HTTP fixtures (success / empty / 5xx / 429) once `lib/packs/http.ts` exists.
5. `fixtures/portfolio.json` + hand-computed `fixtures/expected.json` (the real gate).
6. `README.md` with Coverage, Sources, Quirks. `pnpm test:packs` green. `pnpm codeowners`.

## Current state (2026-09-21)

Milestones 1 (trusted ingestion), 2 (financial kernel and recovery) and 3
(authenticated ledger) are complete; `packs/br` and `packs/global` remain
`draft`. `pnpm release:check` is red only on the two draft packs and
`specs/PERSONAS.md`.

**Milestone 4 — "Brazil to production (MVP)" — is in progress.** Plan:
`docs/milestone-4-plan.md` (conventions, decisions 32–52 — all confirmed
and recorded in `MILESTONES.md` §4 — and the technical-debt inventory paid
in Phase 1). Runbook: `docs/milestone-4-execution.md` (one unit per commit;
its index is the live status). Today's pages are functional and unstyled
(decision 19); the ten designed screens, `br.stock`, budgets, smoke
journeys, `supported` packs and the first deploy are this milestone. The UK
canary is Milestone 5.

From Milestone 1: five real adapters with offline fixtures; `lib/packs`;
`PACK_API_VERSION` 3; forward migrations `initial_schema_hardening`,
`ingest_watermarks`, `commit_ingest_chunk`. The initial migration is applied
and frozen — never edit it in place.

From Milestone 2: `lib/calc/` is the whole pure kernel (module map in its
README); the BR golden portfolio is derived independently by
`packs/br/fixtures/derive_expected.py` and reproduced to `1e-8`;
`lib/backup` + `export_backup()` / `restore_backup(jsonb)` round-trip a
ledger through a real Postgres.

From Milestone 3 (`docs/milestone-3-plan.md`, decisions 19–31 in
`MILESTONES.md` §3): cookie sessions through `@supabase/ssr` with
`proxy.ts` (optimistic) and `lib/auth/session.ts` `requireUser()`
(authoritative, `getUser()` only — `getSession()` is lint-banned); login,
TOTP challenge and password reset; `lib/ledger` text-cast readers and
typed-result writes; snapshot invalidation as database triggers
(`invalidate_snapshots`) and `runSnapshots` behind `GET /api/cron/snapshots`;
CSV import (dry run, all-or-nothing commit, transient `csv_imports`);
Settings with packs, base currency, security and your data. The service
role is constructed only in `app/api/cron/**` and `lib/jobs/**` (lint).
Migrations through `csv_imports` are applied locally.

Local stack: `supabase start -x logflare,studio,vector`; apply a new
migration with `supabase migration up --local`. `pnpm test:db` needs
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` (`supabase status -o env`);
the app also needs `NEXT_PUBLIC_SITE_URL`. Keep `[auth.email]
enable_signup = true` — on this CLI it is the email PROVIDER; signups are
refused by `[auth] enable_signup = false`.
