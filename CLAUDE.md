# Finance Finder

Multi-market personal portfolio tracker. Next.js 16 (App Router) on Vercel,
Supabase (Postgres + RLS), pnpm, TypeScript strict, decimal.js for money, zod
for validation, vitest + fast-check for tests.

@AGENTS.md

## Design documents (root)

| Doc | Status | Owns |
|---|---|---|
| `PACKS.md` | **present** | market-pack architecture; kernel/pack boundary; conformance gates |
| `ARCHITECTURE.md` | **missing** | §2 scope (no tax/fiscal), §3 Vercel Hobby limits, §4 invariants (transactions untouchable, BRL→base currency decomposition, RLS, decimal discipline) |
| `SPEC.md` | **missing** | schema core, calculation formulas + citations, the ten screens, design system, Recharts config, the eight BR benchmarks |
| `MILESTONES.md` | **missing** | delivery order; PACKS.md §14 says `packs/br` from the first commit and a canary `packs/uk` as Milestone 4 |

When the missing docs arrive, reconcile: the initial migration's base columns,
`packs/br/series.ts` benchmark list, and `lib/calc/` formulas.

Your own living spec for user stories lives in `specs/SPEC.md` (QA system);
the root `SPEC.md` is the technical spec. Keep them distinct.

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
pnpm test:packs          # conformance suite only
pnpm codeowners          # regenerate .github/CODEOWNERS from manifests
pnpm db:start / db:reset # local Supabase (Docker)
```

## Non-negotiables

- Money and rates are `decimal.js` in the kernel and **decimal strings** at
  every boundary (pack `FetchResult`, JSON fixtures). Never `parseFloat`, never
  a JS `number` for a value.
- `series_points` has NO `user_id` and NO RLS by design. Do not "fix" it.
- Packs never import from `lib/`, never add npm deps, never use global `fetch`.
  Lint and the conformance suite both enforce this.
- `transactions` and `portfolio_snapshots` are never touched by pack work.
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
calendar and the BCB SGS adapter are real; brapi, Tesouro Transparente and PTAX
adapters are stubs. `lib/calc` and `lib/packs` are empty READMEs. The 13 skipped
conformance tests are the to-do list for Milestone 1.
