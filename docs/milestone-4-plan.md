# Milestone 4 — Brazil to production (MVP): implementation plan

Drafted 2026-09-20 from the tree as it stands after Milestone 3 (`2030858`).
Re-sequenced by the maintainer on 2026-09-20: the UK canary `PACKS.md` §14
placed here moves to Milestone 5, and this milestone takes what
`MILESTONES.md` §5 called "UX and production readiness", scoped to Brazil
(decision 32). `SPEC.md` §9–§12 own the behaviour; `ARCHITECTURE.md` §4,
§7 and §8 own the principles, theme and the deployment steps; `PACKS.md`
§12 owns what "supported" means.

**Status 2026-09-20:** decisions 33–52 confirmed by the maintainer (34
amended: English _and_ Brazilian Portuguese from the start; 40 confirmed on
the condition stated under it) and recorded in `MILESTONES.md` §4. The
step-by-step runbook a worker follows end to end is
`docs/milestone-4-execution.md`; this document stays the _why_.

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

| Phase                                                                                                        | Merge unit           | Status                        |
| ------------------------------------------------------------------------------------------------------------ | -------------------- | ----------------------------- |
| 0 — Baseline: decisions, stories, personas, dependencies, `br.stock`, neutrality                             | `02b9cb4`..`46c0c32` | done 2026-09-21               |
| 1 — Debt paydown and hardening: CI that runs, typed client, coverage, headers, env, the deferred fixes       | `3420c29`..`498004f` | done 2026-09-21               |
| 2 — Foundation and Overview: tokens, fonts, theme, shell, status strip, privacy, formatting, first-run card  | `903d8f8`..`42cf33a` | done 2026-09-21 (gate passed) |
| 3 — Performance and Allocation                                                                               | `aa6014d`..`df1bf25` | done 2026-09-21               |
| 4 — Contribution (with attribution) and Maturities                                                           | `186c88b`..(P4-U2)   | done 2026-09-21               |
| 5 — Ledger screens designed: Assets (schema-driven form), Transactions + import, Cash flows, Settings, Login | —                    | not started                   |
| 6 — Multi-year portfolio, performance budgets                                                                | —                    | not started                   |
| 7 — Smoke journeys, accessibility pass                                                                       | —                    | not started                   |
| 8 — Production readiness: packs supported, runbook, release gate                                             | —                    | not started                   |
| 9 — First deploy (maintainer-gated)                                                                          | —                    | not started                   |

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
trailing zeros trimmed). Dates format per `user_settings.locale`, and so
does the copy: English or Brazilian Portuguese from `lib/copy` (decision
34 as amended).

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
_unpriced_ — never a zero, never a confident number off missing data. One
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
  every migration; the dashboard mirrors `config.toml`'s auth settings —
  signups off, 12-char passwords, TOTP on, the email provider on, the site
  URL and the callback redirect). `docs/DEPLOY.md` is the runbook;
  `.env.example` is complete; nothing is pasted by hand.
- Real data is allowed only after `pnpm release:check` is green
  (MILESTONES.md gate). `supported` is granted per PACKS §12 by the
  maintainer once fixtures are fresh and conformance is fully green.

## Decisions to confirm before implementation

Numbered on from Milestone 3's 31. Decision 32 is the maintainer's own
instruction and is recorded already; the rest (33–52; 47–52 follow the debt
inventory below) are confirmed on the plan's recommendation and then
recorded under `MILESTONES.md` §4.

32. **Re-sequence: Milestone 4 is "Brazil to production"; the UK canary is
    Milestone 5.** PACKS §14 argued a canary before polish catches
    kernel-shape flaws cheaply; three milestones in, the kernel has been
    driven by a real pack, an independently derived golden fixture and the
    live read/write/snapshot paths under RLS. The larger risk now is
    polishing screens no one has used with a full ledger. Recorded as a
    reversal of §14's ordering, with §14's _reason_ preserved by decisions
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
34. **UI copy ships in English and Brazilian Portuguese from the start;
    `user_settings.locale` selects both the copy and the formatting**
    (amended by the maintainer from "English only"). `lib/copy/en.ts` and
    `lib/copy/pt-BR.ts` implement one `Copy` type, so a key present in one
    and missing in the other is a type error and a test; `copyFor(locale)`
    in `lib/copy/index.ts` is the registry — the second and last place a
    locale literal may appear (decision 42's allowlist), because naming the
    languages an instance ships is exactly what that file is for. Before
    sign-in the instance default applies (`INSTANCE_DEFAULTS.locale`); after
    it, the user's setting, mirrored in a preference cookie so the root
    layout sets `lang` without a database read. SPEC quotes its copy in
    English; the pt-BR strings are translations of the same keys, written
    with the screen. PACKS §15's open question closes: a pack's `locale` is
    formatting only; languages are kernel-owned dictionaries.
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
39. **A review gate after Phase 2.** Tokens, type, theme, shell and the
    Overview are shown to the maintainer before the other screens are
    built; direction changes land there, not across nine screens.
40. **Privacy mode is client-only** (`localStorage`, one `<Amount>`
    component, `•••`), exactly SPEC §12.3: a display preference for
    screen-sharing, not a security boundary.
    Confirmed on the condition that the real boundaries stand and are
    exercised: RLS on every user table, `httpOnly` cookie sessions verified
    by `getUser()`, AAL2 before any data page for an enrolled owner, the
    service role confined to cron and `lib/jobs`, value-free logs, and the
    decision 51 headers. Privacy mode is a convenience _inside_ those
    boundaries, never a substitute — so Phase 7's journeys include one that
    requests every data route unauthenticated and at AAL1 with a factor,
    and asserts the redirect, never a render.
41. **`packs/br` and `packs/global` become `supported` in Phase 8**, by
    the maintainer, once fixtures are re-recorded (within 90 days) and
    conformance is fully green. `global` is one PTAX source; it meets §12
    as written.
42. **A kernel-neutrality test** scans `app/` and `lib/` source for pack
    ids, currency codes and locale literals and allows them only in
    `lib/settings/defaults.ts`. This is the enforceable half of
    "multi-country ready".
43. **Deployment is Vercel Hobby + Supabase free tier**, on the
    maintainer's accounts, following `docs/DEPLOY.md`; Phase 9 is gated on
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

## Technical debt inventory — paid early (Phase 1)

Every deferred fix, advisory and latent finding from Milestones 1–3, plus
the infrastructure that never had a phase. "Earlier the better": all but
four land in Phase 1, before a single screen is built, so the screens are
written on a typed client, under CI that actually runs, behind headers,
with the reads they will stress already bounded. Items marked **M** need
the maintainer.

| ID   | Debt                                                                                                                                                                                                                                                                                                   | Source                            | Fix                                                                                                                                                                                                                                                                                          | Phase                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| D-01 | **No git remote; CI has never run.** `.github/workflows/ci.yml` exists; `git remote -v` is empty                                                                                                                                                                                                       | tree                              | **M**: create the GitHub repository, push `main`, confirm the workflow is green. Everything below assumes CI exists                                                                                                                                                                          | 1                                |
| D-02 | CI runs `test` and `test:packs` but not `test:db`; no audit, no format check                                                                                                                                                                                                                           | `ci.yml`                          | Add a job with the Supabase CLI action: `supabase start -x logflare,studio,vector`, env from `supabase status -o env`, `pnpm test:db`; `pnpm audit --audit-level=high`; `pnpm format:check`; later `test:e2e` (decision 46)                                                                  | 1                                |
| D-03 | **Untyped Supabase client**: `pnpm db:types` exists but `lib/database.types.ts` does not; nine `as XRow` casts                                                                                                                                                                                         | tree                              | Decision 49: generate and commit the types, `SupabaseClient<Database>` everywhere, CI diff-checks the file against the local stack; drop the casts where the parser types the `::text` selects                                                                                               | 1                                |
| D-04 | No coverage thresholds although `@vitest/coverage-v8` is installed                                                                                                                                                                                                                                     | `package.json`                    | `pnpm test:coverage`: `lib/calc` ≥ 95 % lines and branches, `lib/ledger` + `lib/jobs` + `lib/import` + `lib/csv` ≥ 85 %; CI enforces                                                                                                                                                         | 1                                |
| D-05 | No security headers; `next.config.ts` is empty                                                                                                                                                                                                                                                         | SPEC §12.1 posture                | Decision 51: CSP with a per-request nonce from `proxy.ts` (Next's guide), HSTS, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, minimal `Permissions-Policy`, `nosniff`, `poweredByHeader: false`; `img-src 'self' data:` for the TOTP QR; fonts self-hosted so no external origin | 1                                |
| D-06 | Environment validated lazily, module by module                                                                                                                                                                                                                                                         | `lib/supabase/*`, `lib/cron/*`    | `lib/env.ts`: one zod parse per runtime (public / server / cron) at first use, failing with variable names; every module reads through it                                                                                                                                                    | 1                                |
| D-07 | Dependencies drifting (next 16.3.5, react 19.3, vitest 5.0.1, fast-check 4.10, tsx, types)                                                                                                                                                                                                             | `pnpm outdated`                   | Bump patch and minor now under the full gate; record the currency policy in `CLAUDE.md`: patch freely, minor with the gate, major as a decision; `pnpm outdated` monthly                                                                                                                     | 1                                |
| D-08 | No formatter; style is by hand                                                                                                                                                                                                                                                                         | tree                              | Decision 50: Prettier, `format` / `format:check`, one formatting-only commit                                                                                                                                                                                                                 | 1                                |
| D-09 | `lib/packs/ingest.ts` carries its own `addDays`                                                                                                                                                                                                                                                        | M2 plan Phase 1 ("leave it")      | Import `lib/calc/dates` (that direction is allowed)                                                                                                                                                                                                                                          | 1                                |
| D-10 | The nulls-first comparator is written twice (`snapshots-store.listUsers`, `ingest.ts` source order)                                                                                                                                                                                                    | M3 CQ-016                         | `lib/util/order.ts` `nullsFirst(key)`                                                                                                                                                                                                                                                        | 1                                |
| D-11 | `listUsers` is N+1: two `limit(1)` reads per user                                                                                                                                                                                                                                                      | M3 Phase 3 grounding              | Read view `snapshot_markers(user_id, last_snapshot_date, earliest_trade_date)`, one paginated select (decision 52 allows read views)                                                                                                                                                         | 1                                |
| D-12 | `store.ts listAssets` `unpriced` reads every price row to diff                                                                                                                                                                                                                                         | M1 comment "should become a view" | Read `asset_latest_prices` for the candidate ids instead — one row per asset                                                                                                                                                                                                                 | 1                                |
| D-13 | `readLedger` reads every price and series row on every call; the analysis screens will call it per request                                                                                                                                                                                             | M3 Phase 2                        | `pricesFrom` / `seriesFrom` options and a `latestPricesOnly` mode for point valuations; Overview reads snapshots + `asset_latest_prices`, not a full valuation                                                                                                                               | 1 (minimal), 6 (if budgets fail) |
| D-14 | Import duplicate detection reads every transaction                                                                                                                                                                                                                                                     | M3 Phase 5                        | Bound the read to the file's `[min, max]` trade date                                                                                                                                                                                                                                         | 1                                |
| D-15 | UI copy scattered: `form.ts REASON_COPY`, three maps on Settings, one on Import                                                                                                                                                                                                                        | M3 CQ-021                         | `lib/copy/{types,en,pt-BR,index}.ts`: one `Copy` type, two complete dictionaries, `copyFor(locale)`; the four maps and the shared strings move in Phase 1, each screen's own strings as it is designed (Phases 2–5) — decision 34 as amended                                                 | 1                                |
| D-16 | A check-constraint failure inside `restore_backup` surfaces as a raw Postgres error                                                                                                                                                                                                                    | M2 CQ-010                         | Forward migration: `exception when others` → `restore_refused: invalid_rows`; `planRestore` already refuses everything the RPC would                                                                                                                                                         | 1                                |
| D-17 | Two concurrent restores into one empty account both pass the emptiness check                                                                                                                                                                                                                           | M2 "what I might have missed"     | Same migration: `pg_advisory_xact_lock(hashtext(auth.uid()::text))` first                                                                                                                                                                                                                    | 1                                |
| D-18 | `writeDay` upserts a whole day in one request; a 1,000-asset day would exceed sane body sizes                                                                                                                                                                                                          | M3 Phase 3 CQ                     | Chunk at 500 rows; a partial day is rebuilt next run because the marker is `max(date)` — document that                                                                                                                                                                                       | 1                                |
| D-19 | Cron runs leave no record beyond the HTTP response                                                                                                                                                                                                                                                     | SPEC §12 allows counts and codes  | Both cron routes `console.log` the summary JSON (counts and codes only) so Vercel's log retains runs; no table                                                                                                                                                                               | 1                                |
| D-20 | Test utilities live beside source (`lib/calc/valuation/testkit.ts`, `lib/ledger/fake-client.ts`)                                                                                                                                                                                                       | tree                              | `fake-client.ts` moves to `lib/testing/`. `testkit.ts` STAYS: `lib/calc` tests are lint-banned from `lib/testing` so `test:calc` can never reach the database harness, and the kit is kernel-pure test support (amended while writing the runbook)                                           | 1                                |
| D-21 | Doc drift: ARCHITECTURE §3 says `@supabase/ssr` _planned_ (installed), Tailwind/shadcn, react-hook-form, date-fns, RTL _planned_; SPEC §12.1 lists AwesomeAPI (removed); README's privacy section says export, tested restore and confirmed deletion are "not present in this scaffold yet" (they are) | tree                              | ARCHITECTURE §3 is rewritten in Phase 0 (the decisions are confirmed, and Phase 0 installs against it); the SPEC and README lines in Phase 1; the §3 table stays the one place _planned_ means anything                                                                                      | 0 (§3), 1 (rest)                 |
| D-22 | `verifyTotp` challenges `totp[0]`; Auth permits up to ten verified factors                                                                                                                                                                                                                             | M3 Phase 1                        | Enrolment already clears leftovers and the UI enrols one; document "one factor" in `lib/auth/README.md`; refuse a second enrolment while one is verified                                                                                                                                     | 1                                |
| D-23 | `parseCsv` builds fields character by character; a 4 MB file is seconds of CPU inside a server action                                                                                                                                                                                                  | M3 Phase 5                        | Measure in Phase 6's budgets; index-scan rewrite only if the 20k-row synthetic file exceeds 500 ms                                                                                                                                                                                           | 6                                |
| D-24 | The "two calendars per pack" kernel question (B3 closes 24/31 Dec, ANBIMA does not)                                                                                                                                                                                                                    | `packs/br/README.md` Quirks       | A `PACK_API_VERSION` question; recorded in PACKS §16 for the canary, where the LSE/bank-holiday split is the same question                                                                                                                                                                   | 0 (document)                     |
| D-25 | `to_char` format ×5 in the backup migration; stale/ok tail ×3 in valuation                                                                                                                                                                                                                             | M2 CQ-009, CQ-003                 | Accepted; recorded here so the acceptance is deliberate                                                                                                                                                                                                                                      | —                                |
| D-26 | Fixtures recorded 2026-09-06; PACKS §12 wants ≤ 90 days for `supported`                                                                                                                                                                                                                                | tree                              | Re-record in Phase 8 (decision 41), and again whenever a fixture is older than 60 days in CI's monthly reminder                                                                                                                                                                              | 8                                |
| D-27 | `lib/cron/budget.ts` assumes no Fluid compute; raising it needs the deployed project's setting                                                                                                                                                                                                         | M1                                | Confirm on the Vercel project in Phase 9; raise both literals if enabled                                                                                                                                                                                                                     | 9                                |
| D-28 | `transactions.fx_rate` is stored, display-only, never populated                                                                                                                                                                                                                                        | M3 non-goal                       | Stays; documented on the form ("optional, display only")                                                                                                                                                                                                                                     | —                                |

## Decisions to confirm before implementation (continued)

Four of these contradict a _planned_ row in `ARCHITECTURE.md` §3, which
says to propose in chat before installing — this is the proposal.

47. **Styling is plain CSS on the SPEC §10 tokens, with CSS Modules where a
    component needs scoping; no Tailwind, no shadcn/ui.** §3 marks both
    _planned_ for "the dashboard build-out". SPEC §10 is a bespoke editorial
    system of nine tokens and two typefaces across ten screens; shadcn
    brings Radix, Tailwind and a house style that is not that one, and
    Tailwind's utility classes would carry the tokens in class names rather
    than in one stylesheet the neutrality test and the theme can reason
    about. ARCHITECTURE §3 is amended.
48. **Forms stay native `<form action>` with server actions; react-hook-form
    is not adopted.** §3 marks it _planned_. Every form built so far is
    progressively enhanced and needs no client state; `useActionState`
    covers pending and error display where a form wants it. Amended.
49. **A typed Supabase client** from `pnpm db:types` (committed
    `lib/database.types.ts`, regenerated and diff-checked in CI against the
    local stack). `SupabaseClient<Database>` replaces the untyped one in
    every factory; explicit row interfaces stay only where the parser
    cannot type a `::text` cast.
50. **Prettier is the formatter**, checked in CI; **CI also runs `test:db`**
    through the Supabase CLI action, `pnpm audit --audit-level=high`, and
    coverage thresholds (D-04). React Testing Library (§3 _planned_) is not
    adopted: pure view models are unit-tested and the browser is covered by
    decision 46's journeys.
51. **Security headers with a nonce-based CSP** from `proxy.ts`, per Next's
    guide. `script-src 'self' 'nonce-…'`, `style-src 'self' 'unsafe-inline'`
    (Next's own inline styles), `img-src 'self' data:` (the TOTP QR),
    `font-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`;
    HSTS in production; `Referrer-Policy: no-referrer`. A header that breaks
    a page is found by the Phase 7 journeys, not by a user.
52. **Forward migrations in this milestone are read views and function
    bodies only; no new user-data tables.** Amends the Non-goals: D-11's
    `snapshot_markers` view and D-16/17's `restore_backup` hardening are
    migrations, and a view is the right answer to a read PostgREST cannot
    express (as `asset_latest_prices` was).

## Decisions to confirm before Phases 3–4 (grounding, 2026-09-21)

Found while grounding the analysis screens against the kernel as built.
Neither changes the golden numbers; both apply decision 10 to time series.

53. **A stale date is not a valuation point.** A snapshot date with any
    `stale` row is excluded from the TWR chain and the cumulative line,
    listed, and drawn as a gap with the stale mark. Its confident total
    omits a holding, so including it would read as a loss and then a gain
    that never happened; decision 10 says stale is never summed. Overview's
    day and period change already read confident totals and are unchanged.
54. **A cash flow in another currency is converted, never thrown.**
    Decision 25 makes a non-base flow unreachable from the forms, but a
    restored file could carry one; the read path converts it with `toBase`
    at its date under the first holdable pack's window and, when that is
    `unpriced`, drops it, counts it, and marks the figure partial.

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
- Every Phase-1 row of the debt inventory is closed: CI green on the
  remote with `test:db`, audit, format and coverage jobs; the typed client;
  headers; `lib/env.ts`; `lib/copy/{en,pt-BR}.ts`; the `snapshot_markers` view; the
  hardened `restore_backup`; dependencies current; ARCHITECTURE §3 true.
- `pnpm test:e2e` passes the eight journeys against the local stack.
- `specs/PERSONAS.md` has no placeholders; US-009 to US-014 have every AC
  ticked; `docs/DEPLOY.md` exists; `.env.example` is complete.
- `packs/br` and `packs/global` are `supported`; `pnpm release:check` is
  green; MILESTONES.md §4 is complete with corrections; the first deploy
  is recorded (URL redacted) with its crons observed firing.

## Non-goals

- No `packs/uk`, no second FX series, no `indexation` for curve bonds, no
  foreign-currency cash flows (Milestone 5).
- No third language and no per-pack copy (decision 34: English and pt-BR,
  kernel-owned), no OAuth, no public signup, no native app, no crypto
  source, no broker integration, no tax figure of any kind.
- No new user-data tables. Forward migrations are limited to read views
  and function bodies (decision 52); a screen that seems to need a table is
  a sign the kernel or a reader is missing something — ask.
- No caching layer for computed returns; no analytics or error-reporting
  SaaS (SPEC §12.1).

## Ordering constraints

- Phase 1 pays the debt before any screen exists: the screens are written
  on the typed client, under a running CI, behind the headers, on bounded
  reads — not retrofitted.
- Decision 42's test and `lib/settings/defaults.ts` land in Phase 0 so
  every screen is written against the rule, not audited after.
- `br.stock` lands in Phase 0 so the golden fixture and every later screen
  exercise seven kinds, not six.
- Phase 2 ends with the review gate (decision 39); Phases 3–5 wait for it.
- Ledger screens are restyled last among the screens (Phase 5) because
  they exist and work today; the analysis screens do not exist at all.
- Budgets (Phase 6) run against the finished screens; smoke tests (Phase 7)
  against the finished screens; `supported` and the release gate (Phase 8)
  after both; the deploy (Phase 9) after the gate is green locally.

## Phase 0 — Baseline: decisions, stories, personas, dependencies, `br.stock`, neutrality

1. ~~Record decisions 33–52 under `MILESTONES.md` §4~~ — done with the
   confirmation (2026-09-20). Rewrite `ARCHITECTURE.md` §3 to the installed
   truth plus the confirmed choices (D-21, first half).
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

## Phase 1 — Debt paydown and hardening

One merge unit per row group, in this order, each under the full gate:

1. **Remote and CI** (D-01 **M**, D-02): the repository on GitHub, `main`
   pushed, the workflow green; then the `test:db` job with the Supabase CLI
   action, `audit`, `format:check`. From here every later phase is CI-gated.
2. **Formatter and dependencies** (D-07, D-08): Prettier config, one
   formatting-only commit; patch/minor bumps; the currency policy in
   `CLAUDE.md`.
3. **Typed client and env** (D-03, D-06): `lib/database.types.ts`, the
   typed factories, casts removed, `lib/env.ts`.
4. **Headers** (D-05): `next.config.ts` headers and the nonce in `proxy.ts`;
   every existing page loads without a CSP report.
5. **Reads and jobs** (D-09–D-14, D-18, D-19): the shared helpers, the
   `snapshot_markers` view (migration), `unpriced` via the latest-price view,
   bounded `readLedger` and import reads, chunked `writeDay`, cron run
   logging.
6. **Restore hardening** (D-16, D-17): the migration; the dbtest gains the
   raw-constraint and concurrent-restore cases.
7. **Copy in both languages, test utilities, docs, one-factor rule** (D-15,
   D-20, D-21 second half, D-22).
8. **Coverage** (D-04) last, once the tree is in its Phase-1 shape, with the
   thresholds enforced in CI.

Tests: every fix keeps its module's tests green; new ones for `nullsFirst`,
`lib/env.ts`, the view, the bounded reads, the restore cases, the copy
module's completeness (every `ActionReason`, `SecurityReason`, restore and
import code has a line). Gates: the full sequence plus `pnpm test:db` and,
now, CI.

## Phase 2 — Foundation and Overview

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
  confident total, or "—" with _N assets unpriced_), day and period change
  from snapshot totals, the sparkline, the allocation donut by kind, top
  movers by per-asset day change; every §9.5 empty state.
- Tests: `lib/format` against `Intl` for two locales and long values;
  status reader with a fake client; Overview data assembly (a pure
  `overviewModel(read, snapshots)` unit-tested over the golden ledger).
- **Review gate**: the maintainer sees `/` and `/login` in both themes on
  desktop and phone before Phase 3.

## Phase 3 — Performance and Allocation

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

## Phase 4 — Contribution and Maturities

- Contribution: per-asset bars over the period from `contribution()`;
  drill into a foreign-currency asset for `attribution()` (all BR assets
  are BRL today, so the drill-in shows `R_fx = 0` — proven, not
  hidden); §9.5 empty.
- Maturities: the ladder from the decision 38 convention — date, days to
  go, current value, contracted value at maturity for plain-rate kinds;
  timeline view; §9.5 empty.
- Tests: view models over the golden ledger; the maturity projection for
  `br.cdb_prefixado` equals `valueAccrual` at its maturity date.

## Phase 5 — Ledger screens designed

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

## Phase 6 — Multi-year portfolio, performance budgets

- `lib/testing/synthetic.ts`: a deterministic five-year, twenty-asset BR
  ledger (all seven kinds, monthly buys, some sells, dividends, daily
  prices with gaps, CDI/IPCA series) seeded through the golden helper.
- `lib/jobs/performance.dbtest.ts`: `runSnapshots` days/s over it;
  `readLedger`, `snapshots.ts` and each view model timed at p50.
- `docs/performance-budgets.md` with the numbers and thresholds; fixes
  only where a threshold fails (date-ranged snapshot reads are the likely
  one).

## Phase 7 — Smoke journeys, accessibility pass

- `e2e/*.spec.ts`: the eight journeys of decision 46 against the local
  stack with a throwaway owner created by the admin API in a global setup
  (TOTP codes from the RFC 6238 generator, moved to `lib/testing/totp.ts`).
- Accessibility checklist in `docs/accessibility.md` walked on every
  screen: landmarks, labels, contrast in both themes (tokens verified
  against WCAG AA), focus order, reduced motion, 400 px width.

## Phase 8 — Production readiness

- Fixtures re-recorded for every source (within 90 days); `packs/br` and
  `packs/global` → `supported`; `pnpm test:packs` fully green with 0
  skips for `br` (the `global` skip is structural: no instruments).
- `docs/DEPLOY.md` (Vercel project + env vars + crons; Supabase project +
  `supabase link` + `db push` + dashboard auth settings + SMTP for reset
  email; `pnpm bootstrap:user` against production); `.env.example`
  complete; `ARCHITECTURE.md` §8 points at it.
- `pnpm release:check` green locally; `CLAUDE.md`, `README.md`,
  `MILESTONES.md` §4 updated.

## Phase 9 — First deploy (maintainer-gated)

- With the maintainer: create the Vercel and Supabase projects, apply the
  runbook, deploy, observe both crons fire once, bootstrap the owner,
  sign in with TOTP, run the smoke journeys against production, record
  the outcome (URL redacted) in MILESTONES.md §4. Real data is allowed
  after this phase and a green `release:check` in CI.

## Suggested merge sequence for a solo maintainer

1. Decisions; stories and personas; dependencies; defaults + neutrality
   test; `br.stock` + fixtures + golden; PACKS §16.
2. Debt paydown, in the eight units above — remote and CI first.
3. Tokens, fonts, theme, formatting, shell, status strip, Overview —
   then the review gate.
4. Snapshot readers, `seriesReturn`, Performance, Allocation.
5. Contribution, Maturities.
6. Schema-driven form; the five ledger screens designed.
7. Synthetic ledger, budgets.
8. Smoke journeys, accessibility.
9. Supported packs, runbook, release gate.
10. First deploy.

The debt is paid first because every later unit is cheaper on a typed
client under a running CI; the neutrality test is early so no screen is
written against Brazil; the review gate is early so no direction is repeated
nine times; the deploy is last because it is the only step this repository
cannot perform alone.
