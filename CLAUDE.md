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
lib/calc/         kernel math, pure functions (TWR, MWR, valuation, series returns, FX)
lib/packs/        kernel pack runtime: PackHttp impl (rate limit/retry/fixtures), activation, ingest job
app/              Next.js routes. app/api/cron/* = the only two crons (by design)
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

## Current state (2026-09-20)

Milestone 1 (trusted ingestion) is complete; Milestone 2 (financial kernel
and recovery) is in progress. `packs/br` and `packs/global` remain `draft`.

From Milestone 1: five real adapters — `global.bcb_ptax` (Olinda CSV),
`br.bcb_sgs` (CDI/SELIC), `br.ibge_sidra` (IPCA número-índice), `br.brapi`
(FII spot/historical + `^BVSP`/`IFIX.SA`), `br.tesouro_transparente`
(`PU Base Manha`, ODbL) — each with recorded success / empty / 5xx / 429
fixtures that replay offline; `lib/packs` (`http`, `redact`, `fixtures`,
`validate`, `activate`, `ingest`, `store`); `PACK_API_VERSION` 3; forward
migrations `initial_schema_hardening`, `ingest_watermarks` and the atomic
`commit_ingest_chunk` RPC. The initial migration is applied and therefore
frozen — never edit it in place. `GET /api/cron/prices` returns a redacted
run summary.

From Milestone 2, Phases 0–2 are merged (`docs/milestone-2-plan.md` keeps the
per-phase table): the `*.dbtest.ts` tier (`pnpm test:db`, fails without the
stack), kernel lint bans, and in `lib/calc/` decimal, money, dates, calendar,
kernel input types + `MarketData`, staleness, FIFO positions, one function per
series kind, and FX resolution — pure and property-tested. Phases 3–7
(valuation strategies + portfolio builder; TWR/MWR/contribution/attribution/
real; the BR golden fixture; backup/restore RPCs + round-trip dbtest; docs)
are not built. `pnpm release:check` is red on `twr.ts`, `mwr.ts`, the golden
results, restore, login, the draft packs and `specs/PERSONAS.md` — run it
rather than trusting this paragraph.
