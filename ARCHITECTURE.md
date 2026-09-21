# ARCHITECTURE.md — Portfolio Dashboard

Agent operating instructions for building this project with Claude Code. Read
this first, then `SPEC.md` for the full schema and screen specs, `PACKS.md` for
the market-pack extensibility layer, and `MILESTONES.md` for the build order.

This document is the north star. When any other document, or your own instinct,
conflicts with the principles in §4, the principles win — or you stop and ask.

> **Document precedence.** `PACKS.md` and the pack-era code it produced (the
> initial migration, `packs/types.ts`, `packs/schema.ts`, the conformance suite)
> are the source of truth for **architecture**: schema shape, kernel/pack
> boundary, multi-country and open-source contribution. This document and
> `SPEC.md` are the source of truth for **features**: scope, principles,
> calculations, screens, design system, edge cases. Where the two disagree on
> structure, PACKS.md and the code win; where they disagree on what the product
> does, this document and SPEC.md win.
>
> **Reconciled edition (Sep 2026).** This supersedes the May 2026 draft. Four
> things that were Brazil-specific in the original are now general: display
> currency is a user setting (not hardcoded BRL), market data lives in a generic
> `series_points` table (not a `benchmarks` table), instruments are described by
> pack-supplied `instrument_kind` + a closed set of valuation strategies (not an
> `asset_class` enum), and price ingestion is done by pack adapters (not six
> hardcoded sources). See `PACKS.md` for why. Everything else is unchanged.

---

## 1. What this project is

A single-user, self-hosted dashboard over a personal investment portfolio
spanning multiple asset classes and currencies. It answers four questions:

1. What is my portfolio worth right now, in my base currency?
2. How does my performance compare against benchmarks?
3. Which asset contributed how much to my return — and for foreign-currency
   holdings, how much came from the asset versus the exchange rate?
4. When do my fixed-income holdings mature, and what cash flow do they generate?

The first market covered is Brazil (`packs/br`), because that is the author's
portfolio. The architecture is built so that a contributor can add another
country as a pack without modifying the kernel. That extensibility is the whole
design intent — but the app must be fully useful with only `packs/br` enabled.

---

## 2. What this project is NOT

Out of scope. Do not build these unless `MILESTONES.md` explicitly schedules them.

- Broker API integrations or scraping (B3, CEI, broker portals). No live
  connection to any broker. Transactions arrive by hand or by **user-supplied
  CSV import** (`SPEC.md` §9 screen 7) — a file the user exports and uploads,
  never a credential the app holds.
- Tax reporting, IR (Imposto de Renda) calculation, DARF generation, or any
  per-jurisdiction fiscal logic. Stay out of fiscal territory entirely — it
  multiplies per-country liability faster than any other feature.
- Order execution. This is read-only analytics, not a trading platform.
- Mobile-native apps. The web app must work in mobile browsers; no React Native
  or PWA work.
- Multi-tenant SaaS features (billing, team management, public sharing). Auth
  exists but signups are disabled. The schema is written multi-user-ready (§4.7)
  so opening it is a config change, not a rewrite — but no signup, billing, or
  sharing UI is built.
- A public asset catalog deduplicated across users. One `assets` table, scoped
  per user. Deferred.
- UI-string localization. Packs supply `locale` for number and date formatting
  only; interface copy stays as-is until a contributor needs otherwise.

When you hit ambiguity about whether something is in scope, default to **not
building it** and ask.

---

## 3. Tech stack (pinned)

What is installed is authoritative (`package.json`, `pnpm-lock.yaml`). This
table is the one place a choice is recorded as agreed; a row that names a
milestone is scheduled there and not installed before it.

| Layer | Choice | State |
|---|---|---|
| Framework | Next.js (App Router) | 16.3.x installed — read `AGENTS.md`: APIs differ from older Next.js |
| UI runtime | React | 19.x installed |
| Language | TypeScript (strict) | 5.x installed |
| Runtime | Node.js | 22.x (`engines: >=22`; CI uses 22) |
| Package manager | pnpm | 10.x (`packageManager` field) — never npm/yarn |
| Styling | Plain CSS on the `SPEC.md` §10 tokens (`app/globals.css`), CSS Modules where a component needs scoping | No utility framework, no component library (`MILESTONES.md` §4 decision 47) |
| Database & auth | Supabase (Postgres 17, per `supabase/config.toml`) via CLI migrations in `supabase/migrations/`; email + password, TOTP MFA optional, signups disabled | `@supabase/supabase-js` 2.116 + `@supabase/ssr` 0.12.7 installed; cookie sessions through `proxy.ts` and `lib/auth/session.ts` |
| Charts | Recharts | installed in Milestone 4 Phase 0, exact-pinned; the only place a decimal string becomes a `number` is `app/(app)/_charts/**` (decision 35) |
| Money math | decimal.js | 10.6.x installed; kernel only — packs pass strings |
| Date math | UTC helpers in `lib/calc/dates.ts` | no date library |
| Forms | Native `<form action>` + server actions + zod | react-hook-form is not adopted (decision 48) |
| Validation | zod | **4.x** installed (`z.iso.date()`, `z.url()` are v4 APIs) |
| UI copy | `lib/copy/<locale>.ts` dictionaries sharing one `Copy` type; English and pt-BR | selected by `user_settings.locale` (decision 34) |
| Formatter | Prettier | Milestone 4 Phase 1, checked in CI (decision 50) |
| Security headers | Nonce-based CSP set by `proxy.ts`; HSTS, `frame-ancestors 'none'`, `no-referrer` in `next.config.ts` | Milestone 4 Phase 1 (decision 51) |
| Hosting | Vercel | Hobby tier |
| Cron | Vercel Cron via `vercel.json` | **Two jobs by design**, not by platform cap (Hobby currently allows up to 100 entries, each at most daily) |
| Testing | Vitest 5 + fast-check 4; `*.dbtest.ts` against the local stack; Playwright (`pnpm test:e2e`) | Playwright installed in Milestone 4 Phase 0; React Testing Library is not adopted — pure view models are unit-tested, the browser is covered by the journeys (decision 50) |

**Do not add libraries without asking first.** If a problem seems to need a new
dependency, propose it in chat before touching `package.json`. Milestone 4
added `recharts`, `@playwright/test` and `prettier`; anything further is a
decision. **Packs add zero npm dependencies** (see `PACKS.md`).

**Do not upgrade major versions** unless explicitly asked. Patch/minor is fine.

---

## 4. Architectural principles

Non-negotiable. Each is the result of an explicit decision; `SPEC.md`
"Architectural Decisions" carries the full rationale. If a change conflicts with
one of these, re-read the rationale before deviating, and ask.

**4.1 Event-sourced ledger.** Positions are never stored. They are derived from
the `transactions` table by summing signed quantities per asset on every read.
Correcting any historical transaction automatically corrects every downstream
number. No `positions` table, no denormalized balance table. The one exception is
`portfolio_snapshots`, which stores daily *valuations* (not positions) for
time-series and contribution; it is write-once and fully reproducible from
transactions + prices + series.

**4.2 Base currency is a user setting; native storage; decompose at read.** All
aggregated views render in the user's `base_currency` (default `BRL`).
Instruments store prices in their `native_currency`. Conversion happens at read
time using the same-day FX series. Returns decompose:
`(1 + R_base) = (1 + R_native) × (1 + R_fx)`. Never store base-converted values
in `prices` — you would lose the information needed for FX attribution.

**4.3 Row-level security everywhere.** Every table holding user data has
`user_id` and an RLS policy scoped to `auth.uid()`. The two non-user tables are
`series_points` (global public market data) and `ingest_cursors` (cron
bookkeeping). They carry no `user_id` and no RLS by design; instead the
migration **revokes write privileges from `anon` and `authenticated`**, so only
the service role (cron) can write. Never use the service role key in
user-facing code paths.

**4.4 Money is decimal, never float.** All monetary values, quantities, prices,
and rates use `decimal.js` via the `Money` wrapper in `lib/calc/money.ts`. JS `number`
is reserved for indexes, counts, and percentages shown to the user. Never
`parseFloat` a money value; never multiply two money values with `*`. The pack
boundary passes values as **strings** for exactly this reason (`PACKS.md` §7).

**4.5 Calculations are pure functions.** All performance math — position
derivation, valuation, TWR, MWR, contribution, FX attribution, real returns —
lives in `lib/calc/` as pure functions: input → output, no side effects, no
Supabase calls inside. The data layer fetches raw rows and hands them in. This is
what makes them unit-testable, and the calc tests are the highest-value tests in
the project.

**4.6 Server components by default.** Fetch data in Next.js Server Components.
Client Components (`'use client'`) are for interactivity only — forms, chart
toggles, theme switch. Do not fetch in Client Components without a specific
reason.

**4.7 Single-user now, multi-user-ready.** Schema, RLS, and code are written as
if many users exist; auth just disallows new signups. No hardcoded user IDs, no
"the user" singletons, every query scoped by `auth.uid()`. Opening signup becomes
a one-toggle change.

**4.8 Packs supply data, never math.** New countries, currencies, instruments,
and data sources arrive as pack contributions under `packs/` — data, identifiers,
and mappings onto the kernel's closed sets of valuation strategies and series
kinds. A pack never adds a valuation function, a migration, or a dependency. If a
contribution genuinely needs new math, that is a kernel change with review. Full
contract in `PACKS.md`; this principle is the one-line version.

**4.9 The self-hoster owns the data, and nothing leaves that they did not
choose.** The database and the app run under the self-hoster's own accounts;
no maintainer, vendor or third party holds a copy. The server sees plaintext —
that is stated, never disguised as end-to-end encryption. Outbound traffic is
limited to pack sources, which receive identifiers and never amounts. No
analytics, telemetry, error-reporting service or CDN-loaded asset by default;
logs never carry row values. Export round-trips through the app's own import;
delete cascades from `auth.users`. Full text in `SPEC.md` §12.

---

## 5. File structure

Directories that exist today are unmarked; *(Milestone 4)* marks routes and
modules scheduled by `docs/milestone-4-plan.md` and not yet created.

```
FInance_Finder/
├─ app/
│  ├─ (app)/                     authed routes, server components — SPEC §9; every page calls requireUser() first
│  │  ├─ page.tsx                Overview (first-run card, headline, sparkline — Milestone 4)
│  │  ├─ performance/  allocation/  contribution/  maturities/     (Milestone 4)
│  │  ├─ assets/  transactions/ (+ import/)  cash-flows/
│  │  ├─ settings/               base currency, packs, theme, locale; security; your data (export route)
│  │  ├─ _components/ _lib/      shared server components and form plumbing
│  │  ├─ _models/ _charts/       (Milestone 4) pure view models; Recharts client components
│  │  ├─ loading.tsx  error.tsx  (Milestone 4)
│  │  └─ layout.tsx              nav, status strip
│  ├─ login/                     email + password; mfa/ (TOTP challenge); reset/
│  ├─ auth/callback/             the one-time-code landing for password reset
│  └─ api/cron/
│     ├─ prices/route.ts         GET — iterate enabled packs' sources
│     └─ snapshots/route.ts      GET — daily valuation snapshots
├─ proxy.ts                      session refresh + optimistic redirects (Next 16 proxy)
├─ lib/
│  ├─ calc/                      PURE functions only (§4.5) — see lib/calc/README.md
│  │  ├─ money.ts                Money wrapper around decimal.js (§4.4)
│  │  ├─ positions.ts            derive positions from transactions
│  │  ├─ valuation/              one module per closed ValuationStrategy kind
│  │  ├─ series/                 one cumulative-return function per closed SeriesKind
│  │  ├─ twr.ts  mwr.ts  contribution.ts  attribution.ts  real.ts  golden.ts
│  │  └─ fx.ts                   base-currency resolution, USD triangulation, staleness
│  ├─ packs/                     kernel-side pack runtime — see lib/packs/README.md
│  │  ├─ http.ts                 PackHttp: rate limit, retry, user-agent, fixture record/replay
│  │  ├─ activate.ts             enabled_packs → manifests, resolving dependencies
│  │  └─ ingest.ts  store.ts     single-invocation price job with per-source budget + cursors
│  ├─ auth/                      access decision, DAL (`requireUser`), security writes
│  ├─ ledger/                    text-cast readers, zod schemas, typed-result writes
│  ├─ jobs/                      after-response work under the service role; the snapshot job
│  ├─ csv/  import/              RFC 4180 reader/writer; column map, dry run, commit planner
│  ├─ backup/                    backup v1 schema, deterministic serializer, restore planner
│  ├─ supabase/                  server.ts (RLS client) · service.ts (cron + lib/jobs ONLY, §4.3) · paginate.ts
│  ├─ settings/                  (Milestone 4) INSTANCE_DEFAULTS — the only literal site (decision 42)
│  ├─ copy/  format/             (Milestone 4) dictionaries in two languages; formatting from decimal strings
│  ├─ testing/                   the dbtest harness and test-only helpers; never imported by lib/calc
│  └─ database.types.ts          generated by `pnpm db:types`; committed from Milestone 4 Phase 1
├─ packs/                        market packs (see PACKS.md)
│  ├─ types.ts  schema.ts        KERNEL-owned pack API and its zod twin — packs import, never edit
│  ├─ index.ts                   static registry: one import line per pack
│  ├─ LICENSES.md                data-licence allowlist
│  ├─ conformance/               `pnpm test:packs` — the merge gate for pack PRs
│  ├─ global/                    FX fixings, crypto, multi-market vendors
│  └─ br/                        Brazil: instruments, series, sources/, calendar, fixtures/, README.md
├─ e2e/                          (Milestone 4) Playwright journeys — `pnpm test:e2e`
├─ scripts/generate-codeowners.ts   .github/CODEOWNERS is generated — never hand-edit
├─ scripts/bootstrap-user.ts        `pnpm bootstrap:user` — creates the single owner (§8)
├─ supabase/
│  ├─ config.toml
│  └─ migrations/                forward migrations; packs ship ZERO migrations
├─ vercel.json                   the two crons
└─ *.test.ts  *.dbtest.ts        Vitest, colocated; `pnpm test:calc` is the highest-value suite
```

`lib/calc/valuation/` and `lib/calc/series/` hold the **closed sets** that
principle 4.8 protects. Packs point at these; packs never add to them.

---

## 6. Data flow

1. **Entry.** User manually enters assets (with pack, instrument kind, native
   currency, metadata) and transactions. Stored in `assets` / `transactions`.
2. **Ingestion (cron).** `GET /api/cron/prices` iterates the sources of
   enabled packs (dependencies resolved transitively), fetches native-currency
   prices and market series, writes `prices` and `series_points`, and records
   per-source progress in `ingest_cursors`. Idempotent — safe to run twice a day.
3. **Snapshot (cron).** `GET /api/cron/snapshots` derives positions, values
   each via its instrument kind's valuation strategy, converts to base currency,
   writes `portfolio_snapshots`.
4. **Read.** Server components pull raw rows, hand them to `lib/calc/` pure
   functions, render. FX conversion and decomposition happen here, at read time.

---

## 7. Theme & aesthetic

Editorial / financial (FT-style). Instrument Serif for display headings, system
sans for body and data. System colour preference with a manual toggle in the
nav; light and dark are both first-class, neither an afterthought. Full tokens in
`SPEC.md` "Design System".

---

## 8. Common tasks

**First-time local setup.**
1. Clone; `pnpm install` (Node 22, pnpm 10 — see `packageManager`).
2. Copy `.env.example` → `.env.local`; fill Supabase credentials.
3. `pnpm db:start` — local Supabase via Docker; applies `supabase/migrations/`.
   For a hosted project, `supabase db push` instead. Never paste SQL by hand.
4. Local signups are disabled in `supabase/config.toml`. For hosted Supabase,
   mirror the checked-in password, signup, and TOTP settings in the dashboard;
   `config.toml` does not configure the hosted project.
5. `pnpm bootstrap:user` — prompts for email + password and creates the owner
   through the service-role key, plus their `user_settings` row. The only
   account-creation path; the app itself never signs anyone up.
6. `pnpm dev`, log in. Overview shows the setup card (`SPEC.md` §9.3) until
   the first asset, transaction and price exist.

**Production-data gate.** `pnpm release:check` is intentionally stricter than
CI and must pass before entering real portfolio data. It rejects draft packs,
stub adapters, missing replay/golden fixtures, placeholder UX, absent kernel
modules, and the currently unimplemented full-restore path. See
`MILESTONES.md`.

**Adding a new country / market.** This is a pack, not a kernel change. See
`PACKS.md` — add `packs/<id>/`, implement its instruments/series/sources against
the kernel API, pass the conformance suite. **No schema change, no migration.**

**Adding a new instrument kind (within a pack).** Add an `InstrumentKind` to the
pack: pick one of the four kernel valuation strategies, supply a zod
`metadataSchema`. No `asset_class` enum edit, no schema change.

**Adding a new benchmark.** Register a `SeriesDescriptor` in the relevant pack
with the `benchmark` role and a source. It appears automatically in the
Performance page toggles. No schema change.

**Running tests.** `pnpm test` runs all suites. `pnpm test:calc` runs only the
calculation tests — the ones that catch financial bugs invisible to UI testing.
`pnpm test:packs` runs the pack conformance suite (`PACKS.md` §11).
`pnpm typecheck && pnpm lint && pnpm test && pnpm test:packs && pnpm codeowners --check`
is what CI runs.

**Manual price ingestion.** `GET /api/cron/prices` with
`Authorization: Bearer $CRON_SECRET` (see `SPEC.md` §7 "Cron authentication").
Idempotent.

**Rebuilding snapshots.** There is no backfill mode. `GET /api/cron/snapshots`
always builds forward from each user's last snapshot (`SPEC.md` §8); deleting
snapshots from a date forward is how history is invalidated, and the next run —
cron or the in-app Refresh — rebuilds it within the time budget, resumably.

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **Base currency** | The currency all aggregated views render in. A user setting; default BRL. |
| **Native currency** | The currency an instrument is denominated/quoted in. |
| **Pack** | A market module (`packs/<id>`) supplying a country's instruments, series, sources, and calendar. Data and mappings only, never math. |
| **Instrument kind** | A pack-declared instrument type mapped to one kernel valuation strategy (e.g. `br.tesouro_direto` → `curve_mark_to_market`). |
| **Series** | A time-series of market data (rate, index level, inflation index, FX, or curve) supplied by a pack and consumed by the kernel. |
| **TWR** | Time-Weighted Return. Geometric chain of sub-period returns, neutralizing cash-flow timing. Used for benchmark comparison. |
| **MWR / XIRR** | Money-Weighted Return / Extended IRR on the user's actual cash-flow stream. "What did I personally earn." |
| **Contribution** | Per-asset share of total return: `weight_i × return_i`; sums to portfolio return. |
| **Attribution** | Decomposition of return into sources — here, asset-driven vs FX-driven for foreign-currency holdings. |
| **MTM** | Mark-to-Market. Valuing at current observable price. |
| **Accrual** | Valuing a fixed-income holding by accumulating contracted interest day by day. |
| **Curve MTM** | Present value of remaining cash flows discounted off a published curve. Government bonds. |
| **CDI / IPCA / SONIA / CPIH** | Examples of pack-supplied series; the kernel treats them by their *kind*, not their name. |
