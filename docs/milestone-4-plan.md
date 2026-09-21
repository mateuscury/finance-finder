# Milestone 4 — Brazil to production (MVP): implementation plan

Drafted 2026-09-20 from the tree as it stands after Milestone 3 (`2030858`).
Re-sequenced by the maintainer on 2026-09-20: the UK canary `PACKS.md` §14
placed here moves to Milestone 5, and this milestone takes what
`MILESTONES.md` §5 called "UX and production readiness", scoped to Brazil
(decision 32). `SPEC.md` §9–§12 own the behaviour; `ARCHITECTURE.md` §4,
§7 and §8 own the principles, theme and the deployment steps; `PACKS.md`
§12 owns what "supported" means.

Every merge unit leaves `pnpm test` and `pnpm test:db` green on `main` and
runs the loop in `.claude/CLAUDE.md`: plan → build → gates →
`/qa-spec-fidelity` → `/qa-code-quality` (and `/qa-ux` for the screen
phases, against `specs/PERSONAS.md`) → fix Must/Should → record Advisory →
next phase.

## Outcome

A Brazilian owner deploys the app to their own Vercel and Supabase
accounts, signs in with a password and an authenticator, loads years of
history from a CSV, and sees every one of the ten screens SPEC §9 names —
with the numbers Milestone 2 proved, on a phone, in either theme, with
amounts hidden when someone is looking over their shoulder. `packs/br` and
`packs/global` are `supported`, `pnpm release:check` is green, and real
portfolio data is allowed for the first time.

**Multi-country readiness is delivered as a seam, not a second pack.**
Nothing in `app/` or `lib/` names Brazil outside one instance-defaults
module (enforced by a test), every screen is driven by the registry and the
user's settings, and `PACKS.md` gains a section listing exactly what the
second pack will meet. Building `packs/uk` is Milestone 5 (decision 45).

## Progress

| Phase | Merge unit | Status |
|---|---|---|
| 0 — Baseline: decisions, stories, personas, dependencies, `br.stock`, neutrality | — | not started |
| 1 — Foundation and Overview: tokens, fonts, theme, shell, status strip, privacy, formatting, first-run card | — | not started |
| 2 — Performance and Allocation | — | not started |
| 3 — Contribution (with attribution) and Maturities | — | not started |
| 4 — Ledger screens designed: Assets (schema-driven form), Transactions + import, Cash flows, Settings, Login | — | not started |
| 5 — Multi-year portfolio, performance budgets | — | not started |
| 6 — Smoke journeys, accessibility pass | — | not started |
| 7 — Production readiness: packs supported, runbook, release gate | — | not started |
| 8 — First deploy (maintainer-gated) | — | not started |

## Why the conventions below are written down first

Milestone 2 pinned arithmetic; Milestone 3 pinned trust boundaries. This
milestone pins **what a number looks like on the way to a screen** — where
a decimal string may become a float, which figures come from the snapshot
cache and which from the kernel at request time, how staleness is shown —
and **what stays generic** so that the second country is a pack and a day's
work, not an audit of every component.

### Screens are server components; charts are the only client data consumers

- Every page under `app/(app)/` is a Server Component that calls
  `requireUser()` first and reads through `lib/ledger`. Client Components
  are for interaction only (ARCHITECTURE §4.6): charts, the theme and
  privacy toggles, the collapsing nav, the TOTP widget, form niceties.
- **The number boundary.** Values reach a page as decimal strings and are
  formatted as strings (below). The ONE place a value becomes a JS `number`
  is inside a chart component, for a coordinate — never for a label, a
  total or anything a person reads. Chart components take `{ x, y }`
  already formatted for display alongside the numeric coordinate, so the
  tooltip prints the string. Lint keeps `parseFloat`/`Number(` banned
  everywhere but `app/(app)/_charts/**`, which is the documented exception.

### Formatting never goes through a float

`lib/format/` formats money, quantities, percentages and dates **from
decimal strings** with the locale's separators taken from
`Intl.NumberFormat(locale).formatToParts(…)`, grouping the integer digits
by hand: a 12-digit total prints exactly, not rounded by IEEE 754. Rules:
tabular numerals (`font-variant-numeric: tabular-nums`), the currency code
or symbol per locale, an explicit sign on every change and return, a fixed
number of decimals per kind (2 for money in the base currency, the asset's
own precision for prices, 2 for percentages, up to 10 for quantities with
trailing zeros trimmed). Dates format per `user_settings.locale`. UI copy
stays English (PACKS §15; decision 34).

### Time series from snapshots, period figures from the kernel

- **Time series** — the sparkline, the performance chart, day and period
  change — read `portfolio_snapshots` (decision 36). Confident totals are
  the sum of `ok` + `carried_forward` rows per date; a date with any
  `stale` row carries the stale mark on the chart.
- **Period figures** — TWR, MWR, contribution, attribution, real return —
  are computed by `lib/calc` at request time from the ledger read
  (`readLedger` → `PortfolioInput`) and, for TWR/MWR, the snapshot totals
  plus cash flows. No new tables; nothing is cached that the kernel can
  recompute in milliseconds for a personal ledger.
- **Benchmarks** — a `benchmark`-role series' return over `[from, to]` is a
  kernel function, `seriesReturn(descriptor, market, from, to)` (decision
  37): `index_level` → `indexReturn`; `rate_daily`/`rate_annual` →
  `compoundRate − 1`; `inflation_index` → level ratio. Whatever a pack
  registers with the role is what the toggles offer (ARCHITECTURE §8).

### Staleness is shown, never hidden

SPEC §11 and decision 10, on every screen: a row whose latest input was
carried forward shows its value with the carried-forward mark and date; a
stale row shows its last known value with the stale mark and is excluded
from every confident total; an unpriced position shows its quantity and
*unpriced* — never a zero, never a confident number off missing data. One
`<ValueStatus>` component renders the mark; the copy is the §9.5 table.

### The design system (SPEC §10)

- Tokens in `app/globals.css` exactly as §10 lists them (`--bg`,
  `--bg-subtle`, `--surface`, `--border-hairline`, `--text`, `--text-muted`,
  `--pos`, `--neg`, `--accent`), light and dark both first-class, `--pos`
  and `--neg` never the only carrier of meaning (sign and arrow alongside).
- Type: Instrument Serif through `next/font/google` (downloaded at build,
  served from the app's origin — SPEC §12.1) for display headings and large
  figures; the system sans stack for body, tables and controls.
- Theme: `user_settings.theme` rendered as `data-theme` on `<html>` by the
  root layout (no flash), `system` deferring to `prefers-color-scheme`; the
  nav toggle is a server action that writes the setting.
- Charts: Recharts (ARCHITECTURE §7's table; decision 35) — thin strokes,
  no heavy gridlines, direct labels over legends, benchmark lines muted, the
  portfolio line the accent, axes formatted per locale.
- Navigation (§9.2): two groups always fully visible; hairline rule; a
  menu on narrow viewports; the status strip beneath, present only when
  something is pending, carrying Refresh and nothing else.
- Privacy mode (§12.3; decision 40): a client toggle beside the theme
  switch, remembered in `localStorage`, masking every amount and quantity
  as `•••` through one `<Amount>` component; names, percentages and returns
  stay visible. Client-only, never stored server-side.
- Accessibility: landmarks, a skip link, labelled controls, `aria-live` on
  the status strip, `loading.tsx` and `error.tsx` under `app/(app)/`
  (error boundaries show fixed copy, never a stack), focus-visible styles,
  `prefers-reduced-motion` respected by charts.

### Neutrality: the multi-country seam

- **One instance-defaults module.** `lib/settings/defaults.ts` exports
  `INSTANCE_DEFAULTS = { baseCurrency: "BRL", locale: "pt-BR", enabledPacks:
  [] }` — the values the database defaults also carry — and is the ONLY
  place in `app/` and `lib/` a pack id, currency code or locale literal may
  appear. A test, `packs/conformance/kernel-neutrality.test.ts`, scans
  `app/` and `lib/` source (tests and `lib/testing` excluded) for
  `"br"`, `"BRL"`, `"pt-BR"`, `"global"` and fails on any other occurrence
  (decision 42). Today's occurrences (`app/layout.tsx` `lang`,
  `readSettings`'s fallback, the cash-flow fallback) move behind it.
- **Registry-driven UI.** The asset form renders its metadata fields from
  the kind's `metadataSchema` shape (`lib/forms/zod-fields.ts`: string,
  decimal string, date, optional); the pack and kind selects come from
  `PACKS`; benchmark toggles and the deflator come from series roles; the
  Maturities screen finds fixed-income by a documented optional metadata
  convention (decision 38). No screen knows a BR kind by name.
- **The documented seam.** `PACKS.md` gains §16 "What the second pack will
  meet": the assumptions Milestones 2–4 made that a canary must verify —
  base-currency-only cash flows (decision 25), USD-pivot triangulation for
  FX, the union trading calendar of holdable packs (decision 21), the
  `maturity` metadata convention, `curve_mark_to_market` without
  `indexation` (decision 7), rate series on `BUS/252` being the only ones
  exercised. That section IS the placeholder (decision 45): a checklist,
  not a stub pack.

### Production

- Deployment is the maintainer's accounts: Vercel (the two crons in
  `vercel.json`, `maxDuration` 60 without Fluid compute — `lib/cron/
  budget.ts`) and a hosted Supabase project (`supabase db push` applies the
  nine migrations; the dashboard mirrors `config.toml`'s auth settings —
  signups off, 12-char passwords, TOTP on, the email provider on, the site
  URL and the callback redirect). `docs/DEPLOY.md` is the runbook;
  `.env.example` is complete; nothing is pasted by hand.
- Real data is allowed only after `pnpm release:check` is green
  (MILESTONES.md gate). `supported` is granted per PACKS §12 by the
  maintainer once fixtures are fresh and conformance is fully green.

## Decisions to confirm before implementation

Numbered on from Milestone 3's 31. Decision 32 is the maintainer's own
instruction and is recorded already; the rest are confirmed on the plan's
recommendation and then recorded under `MILESTONES.md` §4.

32. **Re-sequence: Milestone 4 is "Brazil to production"; the UK canary is
    Milestone 5.** PACKS §14 argued a canary before polish catches
    kernel-shape flaws cheaply; three milestones in, the kernel has been
    driven by a real pack, an independently derived golden fixture and the
    live read/write/snapshot paths under RLS. The larger risk now is
    polishing screens no one has used with a full ledger. Recorded as a
    reversal of §14's ordering, with §14's *reason* preserved by decisions
    42 and 45.
33. **Add `br.stock`** — ações, ETFs and BDRs listed on B3, `market_price`
    through `br.brapi`, `ticker` identifier, `FiiMetadata`-like
    `{ name }` metadata. Beyond PACKS §13's migrated list (TD, CDB/LCI,
    FII), but data-only, served by the same free-plan quote endpoint, and
    the first thing a Brazilian owner with a brokerage account holds. One
    catalog case, re-recorded fixtures, a README row, and one golden row
    (the derivation script re-run; `expected.json` regenerated, never
    hand-edited). BDRs carry the SPEC §11 known gap (zero FX attribution),
    stated in the README. Poupança and fundos stay out: each needs a new
    source and a licence review.
34. **UI copy stays English; the locale drives formatting only** (PACKS
    §15). pt-BR is the instance default. Translation is a later
    contribution with a real request behind it.
35. **Charts are Recharts** (ARCHITECTURE §7 names it; version pinned), the
    only new production dependency. Chart coordinates are the one place a
    decimal string becomes a `number`, inside `app/(app)/_charts/**`, which
    lint exempts and the neutrality test still scans.
36. **Time series from `portfolio_snapshots`; period figures from the
    kernel at request time.** No new tables, no cached returns. A personal
    ledger's `valuePortfolio` at two dates plus `contribution` is
    milliseconds; a cache would be a second thing to invalidate.
37. **`lib/calc/benchmark.ts` `seriesReturn(descriptor, market, from, to)`**
    is a kernel addition: one function over the closed `SeriesKind` union
    returning `Observed<KDecimal>`, so a pack's `benchmark` role needs no
    per-kind UI code. Property: for an `index_level` series it equals
    `indexReturn`; for a constant `rate_daily` it equals `(1 + r)^n − 1`.
38. **Maturities read a documented optional convention:** an instrument
    kind whose `metadataSchema` includes `maturity: IsoDate` appears on the
    Maturities screen (PACKS §5 gains the sentence). The screen shows the
    date, the current value, and — for plain-rate accrual kinds only — the
    contracted value at maturity (`valueHolding` at the maturity date needs
    no future series). Indexed kinds show "final amount depends on the
    index" and no projection: a guessed CDI path would be a confident
    number off missing data (§11).
39. **A review gate after Phase 1.** Tokens, type, theme, shell and the
    Overview are shown to the maintainer before the other screens are
    built; direction changes land there, not across nine screens.
40. **Privacy mode is client-only** (`localStorage`, one `<Amount>`
    component, `•••`), exactly SPEC §12.3: a display preference for
    screen-sharing, not a security boundary.
41. **`packs/br` and `packs/global` become `supported` in Phase 7**, by
    the maintainer, once fixtures are re-recorded (within 90 days) and
    conformance is fully green. `global` is one PTAX source; it meets §12
    as written.
42. **A kernel-neutrality test** scans `app/` and `lib/` source for pack
    ids, currency codes and locale literals and allows them only in
    `lib/settings/defaults.ts`. This is the enforceable half of
    "multi-country ready".
43. **Deployment is Vercel Hobby + Supabase free tier**, on the
    maintainer's accounts, following `docs/DEPLOY.md`; Phase 8 is gated on
    those accounts existing and is performed with the maintainer, not
    unattended. `CRON_SECRET` is generated by `openssl rand -base64 32`;
    `NEXT_PUBLIC_SITE_URL` is the Vercel production URL.
44. **Performance budgets are measured, not assumed:** a synthetic
    five-year, twenty-asset BR ledger generator (`lib/testing/synthetic.
    ts`), a dbtest that times `runSnapshots` (days built per second) and
    each screen's read path, and `docs/performance-budgets.md` recording
    the numbers and the thresholds (`runSnapshots` ≥ 50 days/s; any screen
    read < 500 ms at p50 on the local stack). Optimisation happens only
    where a budget fails.
45. **The multi-country placeholder is PACKS §16 + decision 42 + the
    registry-driven form** — no `packs/uk` directory, no template pack, no
    kernel type change. A stub pack would have to pass conformance or be
    excluded from the registry, and either is worse than a checklist.
46. **Add Playwright smoke journeys** (`pnpm test:e2e`, a tier like
    `dbtest`: fails loudly without browsers, excluded from `pnpm test`,
    required by `release:check`): sign in → enrol TOTP → add an asset →
    import the golden CSV → see Overview, Performance, Maturities → export
    → privacy mode → mobile viewport. Eight journeys, one file each.
    Rationale: this is the milestone that permits real data, and no page
    has been driven by a browser yet; the UK milestone will not touch
    screens, so this is the last cheap moment. Cost: a large
    devDependency with browser binaries; kept out of the default test run.

## Definition of done

- The ten screens of SPEC §9 exist under `app/(app)/` with the §10 design
  system, both themes, the §9.2 nav and status strip, the §9.3 first-run
  card, the §9.5 empty states verbatim, stale/unpriced marks on every
  screen, privacy mode, `loading.tsx`/`error.tsx`, and phone-width layouts.
- `lib/format/` formats every value from decimal strings (unit-tested
  against `Intl` separators for `pt-BR` and `en-GB`); `lib/calc/
  benchmark.ts` exists with its properties; `lib/ledger/snapshots.ts`
  reads time series as text.
- `br.stock` is registered with fixtures, a README row and a golden row;
  `expected.json` is regenerated by the script and the kernel still
  matches to `1e-8`.
- `packs/conformance/kernel-neutrality.test.ts` passes; `lib/settings/
  defaults.ts` is the only literal site; `PACKS.md` §16 exists.
- `docs/performance-budgets.md` records measured numbers within the
  thresholds of decision 44.
- `pnpm test:e2e` passes the eight journeys against the local stack.
- `specs/PERSONAS.md` has no placeholders; US-009 to US-014 have every AC
  ticked; `docs/DEPLOY.md` exists; `.env.example` is complete.
- `packs/br` and `packs/global` are `supported`; `pnpm release:check` is
  green; MILESTONES.md §4 is complete with corrections; the first deploy
  is recorded (URL redacted) with its crons observed firing.

## Non-goals

- No `packs/uk`, no second FX series, no `indexation` for curve bonds, no
  foreign-currency cash flows (Milestone 5).
- No UI translation (PACKS §15), no OAuth, no public signup, no native app,
  no crypto source, no broker integration, no tax figure of any kind.
- No new tables or migrations (a screen that seems to need one is a sign
  the kernel or a reader is missing something — ask).
- No caching layer for computed returns; no analytics or error-reporting
  SaaS (SPEC §12.1).

## Ordering constraints

- Decision 42's test and `lib/settings/defaults.ts` land in Phase 0 so
  every screen is written against the rule, not audited after.
- `br.stock` lands in Phase 0 so the golden fixture and every later screen
  exercise seven kinds, not six.
- Phase 1 ends with the review gate (decision 39); Phases 2–4 wait for it.
- Ledger screens are restyled last among the screens (Phase 4) because
  they exist and work today; the analysis screens do not exist at all.
- Budgets (Phase 5) run against the finished screens; smoke tests (Phase 6)
  against the finished screens; `supported` and the release gate (Phase 7)
  after both; the deploy (Phase 8) after the gate is green locally.

## Phase 0 — Baseline: decisions, stories, personas, dependencies, `br.stock`, neutrality

1. Record decisions 33–46 under `MILESTONES.md` §4; swap §4/§5 headings
   (decision 32, already recorded).
2. `specs/PERSONAS.md`: the primary persona (the self-hosting Brazilian
   investor — holds Tesouro, CDBs, FIIs and a few ações; checks on a phone;
   moderate tech comfort; wants one honest number and no surprises) and
   the secondary one (the pack contributor). `specs/SPEC.md`: US-009
   "See my portfolio at a glance" (Overview, first-run card, status
   strip), US-010 "Compare my return" (Performance, benchmarks, real),
   US-011 "See what I hold and what drove it" (Allocation, Contribution,
   attribution), US-012 "Know what matures when" (Maturities), US-013
   "Use it on my phone, in my theme, in front of others" (design system,
   mobile, theme, privacy, accessibility, empty and stale states), US-014
   "Run it in production" (deploy, supported packs, budgets, smoke tests,
   release gate). Every AC cites its SPEC section.
3. Dependencies: `recharts` (pinned), `@playwright/test` (dev, pinned);
   `pnpm test:e2e` script and `playwright.config.ts` pointing at the local
   stack; `release:check` gains `pnpm test:e2e`.
4. `lib/settings/defaults.ts` + `packs/conformance/kernel-neutrality.test.
   ts`; move today's five literals behind it (`app/layout.tsx` `lang`, the
   currency defaults in the asset and transaction forms, the import
   preview's prefill, `readSettings`'s fallback row). The test allows
   exactly one non-pack use of the word: `signOut({ scope: "global" })` is
   Supabase's scope, not the pack id. Lint: exempt `app/(app)/_charts/**`
   from the float ban (and nothing else).
5. `br.stock` in `packs/br/instruments.ts`; a stock ticker in the brapi
   catalog (`success`/`empty` spot and historical); `pnpm fixtures:record
   --source br.brapi` (live, with the maintainer's token; redaction as in
   Milestone 1); README coverage row with the BDR note; one `br.stock`
   asset, buy and price rows in `portfolio.json`; `derive_expected.py`
   re-run; conformance green.
6. `PACKS.md` §16 "What the second pack will meet" and the §5 `maturity`
   sentence (decision 38).

## Phase 1 — Foundation and Overview

- `app/globals.css` tokens, both themes; `next/font/google` Instrument
  Serif + system sans in the root layout; `data-theme` from settings;
  `lang` from the locale.
- `lib/format/{money,percent,date,quantity}.ts` from decimal strings.
- Shell: `app/(app)/layout.tsx` with the §9.2 nav (two groups, always
  visible, menu under 640 px), theme toggle (server action), privacy
  toggle (`<PrivacyProvider>`, `<Amount>`), sign out; `loading.tsx`,
  `error.tsx`, skip link.
- Status strip: `lib/ledger/status.ts` (`assetsUnpriced` count — the one
  deferred from Milestone 3 —, the rebuild gap from `max(snapshot date)`
  vs the last trading day, disabled sources from `ingest_cursors`) and the
  strip component with Refresh (moved from `/assets`).
- Overview: the §9.3 first-run card from row counts; headline (latest
  confident total, or "—" with *N assets unpriced*), day and period change
  from snapshot totals, the sparkline, the allocation donut by kind, top
  movers by per-asset day change; every §9.5 empty state.
- Tests: `lib/format` against `Intl` for two locales and long values;
  status reader with a fake client; Overview data assembly (a pure
  `overviewModel(read, snapshots)` unit-tested over the golden ledger).
- **Review gate**: the maintainer sees `/` and `/login` in both themes on
  desktop and phone before Phase 2.

## Phase 2 — Performance and Allocation

- `lib/ledger/snapshots.ts`: confident totals per date, per-asset series,
  latest rows — text-cast, paginated, date-ranged.
- `lib/calc/benchmark.ts` `seriesReturn` + properties.
- Performance: period selector (1M, YTD, 1Y, all — from the first
  snapshot), TWR from snapshot totals + cash flows, MWR, the chart with
  benchmark toggles from `benchmark`-role series, nominal/real toggle from
  the `deflator` role; §9.5 empties ("Needs two days of history…",
  "Benchmarks arrive with the nightly ingest.").
- Allocation: by instrument kind, by pack, by currency; native vs base
  exposure; from the latest snapshot rows.
- Tests: pure view models over the golden ledger and its snapshots; the
  TWR shown equals `expected.json`'s over the golden dates.

## Phase 3 — Contribution and Maturities

- Contribution: per-asset bars over the period from `contribution()`;
  drill into a foreign-currency asset for `attribution()` (all BR assets
  are BRL today, so the drill-in shows `R_fx = 0` — proven, not
  hidden); §9.5 empty.
- Maturities: the ladder from the decision 38 convention — date, days to
  go, current value, contracted value at maturity for plain-rate kinds;
  timeline view; §9.5 empty.
- Tests: view models over the golden ledger; the maturity projection for
  `br.cdb_prefixado` equals `valueAccrual` at its maturity date.

## Phase 4 — Ledger screens designed

- `lib/forms/zod-fields.ts`: fields from a `z.object` shape (string,
  `DecimalStringSchema`, `IsoDateSchema`, optional) with labels from the
  key; the asset form becomes pack → kind → generated metadata fields →
  currency (SPEC §9 screen 6), the JSON textarea gone.
- Assets (row states: priced / carried forward / stale / unpriced with
  reason / accrues), Transactions + the import flow (upload → map →
  preview → commit) styled as steps, Cash flows, Settings (sections per
  §9 screen 9), Login / MFA / reset. Stale and unpriced marks and every
  §9.5 empty state; phone layouts; keyboard order.
- Tests: `zod-fields` over every in-repo `metadataSchema`; existing
  action tests unchanged.

## Phase 5 — Multi-year portfolio, performance budgets

- `lib/testing/synthetic.ts`: a deterministic five-year, twenty-asset BR
  ledger (all seven kinds, monthly buys, some sells, dividends, daily
  prices with gaps, CDI/IPCA series) seeded through the golden helper.
- `lib/jobs/performance.dbtest.ts`: `runSnapshots` days/s over it;
  `readLedger`, `snapshots.ts` and each view model timed at p50.
- `docs/performance-budgets.md` with the numbers and thresholds; fixes
  only where a threshold fails (date-ranged snapshot reads are the likely
  one).

## Phase 6 — Smoke journeys, accessibility pass

- `e2e/*.spec.ts`: the eight journeys of decision 46 against the local
  stack with a throwaway owner created by the admin API in a global setup
  (TOTP codes from the RFC 6238 generator, moved to `lib/testing/totp.ts`).
- Accessibility checklist in `docs/accessibility.md` walked on every
  screen: landmarks, labels, contrast in both themes (tokens verified
  against WCAG AA), focus order, reduced motion, 400 px width.

## Phase 7 — Production readiness

- Fixtures re-recorded for every source (within 90 days); `packs/br` and
  `packs/global` → `supported`; `pnpm test:packs` fully green with 0
  skips for `br` (the `global` skip is structural: no instruments).
- `docs/DEPLOY.md` (Vercel project + env vars + crons; Supabase project +
  `supabase link` + `db push` + dashboard auth settings + SMTP for reset
  email; `pnpm bootstrap:user` against production); `.env.example`
  complete; `ARCHITECTURE.md` §8 points at it.
- `pnpm release:check` green locally; `CLAUDE.md`, `README.md`,
  `MILESTONES.md` §4 updated.

## Phase 8 — First deploy (maintainer-gated)

- With the maintainer: create the Vercel and Supabase projects, apply the
  runbook, deploy, observe both crons fire once, bootstrap the owner,
  sign in with TOTP, run the smoke journeys against production, record
  the outcome (URL redacted) in MILESTONES.md §4. Real data is allowed
  after this phase and a green `release:check` in CI.

## Suggested merge sequence for a solo maintainer

1. Decisions; stories and personas; dependencies; defaults + neutrality
   test; `br.stock` + fixtures + golden; PACKS §16.
2. Tokens, fonts, theme, formatting, shell, status strip, Overview —
   then the review gate.
3. Snapshot readers, `seriesReturn`, Performance, Allocation.
4. Contribution, Maturities.
5. Schema-driven form; the five ledger screens designed.
6. Synthetic ledger, budgets.
7. Smoke journeys, accessibility.
8. Supported packs, runbook, release gate.
9. First deploy.

The neutrality test is early so no screen is written against Brazil; the
review gate is early so no direction is repeated nine times; the deploy is
last because it is the only step this repository cannot perform alone.
