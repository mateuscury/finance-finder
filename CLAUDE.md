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
| `MILESTONES.md` | **missing** — delivery order. PACKS.md §14: `packs/br` from the first commit, canary `packs/uk` + conformance as Milestone 4 |

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
app/              Next.js routes. app/api/cron/* = the ONLY two Vercel Hobby crons
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
pnpm codeowners          # regenerate .github/CODEOWNERS from manifests
pnpm db:start / db:reset # local Supabase (Docker)
```

## Non-negotiables

- Money and rates are `decimal.js` in the kernel and **decimal strings** at
  every boundary (pack `FetchResult`, JSON fixtures). Never `parseFloat`, never
  a JS `number` for a value.
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
- Two Vercel crons total. Ingestion iterates sources inside one invocation
  with a per-source time budget and `ingest_cursors` resume markers.
- `PACK_API_VERSION` bump ⇒ same PR updates every in-repo pack.

## Adding a pack (contributor path)

1. `packs/<id>/index.ts` exporting a `MarketPack`; register in `packs/index.ts`.
2. Every id prefixed `<id>.`; sources' `license` from `packs/LICENSES.md`.
3. Adapters use only `ctx.http`; return decimal strings.
4. Record HTTP fixtures (success / empty / 5xx / 429) once `lib/packs/http.ts` exists.
5. `fixtures/portfolio.json` + hand-computed `fixtures/expected.json` (the real gate).
6. `README.md` with Coverage, Sources, Quirks. `pnpm test:packs` green. `pnpm codeowners`.

## Current state (2026-09-05)

Scaffold only. `packs/br` and `packs/global` are `draft`: manifests, B3/ANBIMA
calendar and the BCB SGS adapter are real; brapi, Tesouro Transparente, PTAX
and AwesomeAPI adapters are stubs. `lib/calc` and `lib/packs` are empty READMEs.
The initial migration is reconciled with SPEC.md (txn_type enum, cash_flows,
per-asset snapshots with `carried_forward`, manual prices) and has not been
applied to any environment yet — it may still be edited in place. The 13
skipped conformance tests are the to-do list for Milestone 1. `app/page.tsx`
is still the Next.js starter. Specified but unbuilt: CSV import (SPEC §9.1),
navigation/first-run/empty states (SPEC §9.2–9.5), auto price fetch on asset
creation, resumable snapshot rebuild (SPEC §8), and `scripts/bootstrap-user.ts`
— do not add its `package.json` entry until the script exists.
