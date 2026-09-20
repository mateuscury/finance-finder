# Finance Finder

Self-hostable, multi-market personal portfolio tracker. Brazil first
(Tesouro Direto, CDB/LCI/LCA, FIIs), designed from the first commit so that
other markets are added as **packs** of data and mappings, never as new math.

Read [`PACKS.md`](./PACKS.md) for the architecture (multi-country packs,
kernel boundary, contribution model), then [`ARCHITECTURE.md`](./ARCHITECTURE.md)
for principles and scope and [`SPEC.md`](./SPEC.md) for calculations, screens
and design. [`MILESTONES.md`](./MILESTONES.md) defines delivery and safety
gates. Precedence between them is
set out in [`CLAUDE.md`](./CLAUDE.md).

## Stack

Next.js 16 · Supabase (Postgres, RLS) · Vercel (two crons, by design) · pnpm ·
TypeScript · decimal.js · zod · vitest + fast-check

## Getting started

Prerequisites: Node 22+, pnpm 10, a Docker-compatible container runtime, and
the Supabase CLI. The checked-in local configuration disables public signups.

```bash
pnpm install
cp .env.example .env.local        # fill Supabase keys
pnpm db:start                     # local Supabase via Docker; applies supabase/migrations
pnpm bootstrap:user               # create the one owner without enabling signups
pnpm dev
```

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:packs
```

## Contributing a market pack

See the "Adding a pack" section in [`CLAUDE.md`](./CLAUDE.md) and the
conformance suite in `packs/conformance/`. `pnpm test:packs` is the gate.

## Status

Milestone 1 (trusted ingestion) is complete; Milestone 2 (financial kernel
and recovery) is in progress — positions, series kinds and FX exist;
valuation, TWR/MWR and backup/restore do not. Packs `br` and `global` are
draft. Status of record: `MILESTONES.md`.

**Do not enter real portfolio data yet.** Normal CI validates development work,
including explicitly skipped draft-pack tests. `pnpm release:check` is the
separate production-data gate and intentionally fails until all adapters,
financial golden tests, authentication screens, and full backup restore are
implemented. Draft packs are never enabled for new users.

## Licence

[GNU AGPL-3.0](./LICENSE). Self-hosting for yourself carries no obligation;
running a modified version as a network service means publishing your changes.

Data sources are licensed separately and independently — each pack source
declares a licence from the allowlist in [`packs/LICENSES.md`](./packs/LICENSES.md).
The AGPL covers this code, not the market data it fetches.

## Privacy & trust

**You run the server, and the server sees your data.** Your portfolio lives in
your own Supabase project, encrypted at rest and in transit; the app runs on
your own Vercel account. Nobody else has a copy, including this project's
maintainers. It is not end-to-end encrypted — the calculations run server-side.

What leaves your instance: market-data sources receive the **ticker and series
codes** you hold (plus their own API token) — never quantities, prices paid or
values. Nothing else goes anywhere: no analytics, no telemetry, no
error-reporting service, fonts served from your own origin. Full detail in
[`SPEC.md`](./SPEC.md) §12.

The target product has one owner account created from the CLI, disabled public
signups, and optional TOTP. Export, tested full restore, backup reminders, and
confirmed deletion are release-gated features described in `SPEC.md`; they are
not present in this scaffold yet.

## Disclaimer

Not financial advice. This is a personal analytics tool that computes figures
from data you enter and from third-party sources that can be wrong, delayed, or
unavailable. It performs no tax or fiscal calculation of any kind. Verify
anything you act on. Provided without warranty, as set out in the licence.
