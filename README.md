# Finance Finder

Self-hostable, multi-market personal portfolio tracker. Brazil first
(Tesouro Direto, CDB/LCI/LCA, FIIs), designed from the first commit so that
other markets are added as **packs** of data and mappings, never as new math.

Read [`PACKS.md`](./PACKS.md) for the architecture. `ARCHITECTURE.md`,
`SPEC.md` and `MILESTONES.md` are referenced by it and still to be added.

## Stack

Next.js 16 · Supabase (Postgres, RLS) · Vercel (two crons) · pnpm ·
TypeScript · decimal.js · zod · vitest + fast-check

## Getting started

```bash
pnpm install
cp .env.example .env.local        # fill Supabase keys
pnpm db:start                     # local Supabase via Docker; applies supabase/migrations
pnpm dev
```

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:packs
```

## Contributing a market pack

See the "Adding a pack" section in [`CLAUDE.md`](./CLAUDE.md) and the
conformance suite in `packs/conformance/`. `pnpm test:packs` is the gate.

## Status

Scaffold. Packs `br` and `global` are draft. Kernel math not yet implemented.
