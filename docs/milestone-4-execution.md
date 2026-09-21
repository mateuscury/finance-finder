# Milestone 4 — execution runbook

For the worker who executes Milestone 4 from the first unit to the hand-off
without needing to ask a question that this document or the tree can answer.
`docs/milestone-4-plan.md` is the _why_ (conventions, decisions 32–52, the
debt inventory); this is the _what, in which order, and how you know it is
done_. Decisions 33–52 are confirmed and recorded in `MILESTONES.md` §4 —
nothing below is open for interpretation except where a unit says
"choose".

Written 2026-09-20 from the tree at `5effa92` plus the confirmation commit.

## 0. How to work this document

### 0.1 Before the first unit

1. `git status` is clean and `git log --oneline -1` is on `main`.
2. The local stack is up: `supabase start -x logflare,studio,vector`.
   `.env.local` has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (from `supabase status -o env`),
   `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000`, a 32-byte `CRON_SECRET`
   (`openssl rand -base64 32`) and `BRAPI_TOKEN` (present; needed by P0-U5).
   Never print a value; name variables only.
3. The full gate is green before you start:
   `pnpm typecheck && pnpm lint && pnpm test && pnpm test:db && pnpm test:packs`.
   If it is not, stop and report — do not start on a red tree.
4. Read, in this order: `CLAUDE.md`, `AGENTS.md` (then the Next 16 docs it
   points at for any API you touch), `docs/milestone-4-plan.md` whole,
   `MILESTONES.md` §4, `SPEC.md` §9–§12, `PACKS.md` §12 and §15,
   `lib/calc/README.md`, `lib/ledger/README.md`, `lib/jobs/README.md`,
   `lib/auth/README.md`, `.claude/CLAUDE.md`.

### 0.2 The loop, per unit

Every unit is one commit on `main` and goes through exactly this loop:

1. **Read first** — the files the unit lists. Never edit a file you have not
   read in this session.
2. **Build** the steps in order. Match the surrounding code's comment
   density and idiom. Doc comments explain _why_, tests prove _what_.
3. **Tests** — write the ones the unit names; keep every existing test green.
4. **Gate** — `pnpm typecheck && pnpm lint && pnpm test && pnpm test:db`
   (`pnpm test:packs` whenever `packs/**` or `lib/calc/**` changed;
   `pnpm build` whenever `app/**`, `proxy.ts` or `next.config.ts` changed;
   `pnpm test:e2e` from P7-U1 on). Once CI exists (P1-U1), a unit is done
   only when CI is green on the pushed commit.
5. **QA** — run `/qa-spec-fidelity` and `/qa-code-quality` with the arguments
   the unit gives (`/qa-ux` too for every screen unit, against
   `specs/PERSONAS.md`). Fix every Must and Should. Record each Advisory
   you do not act on in `MILESTONES.md` §4 under "Advisories recorded"
   (create the heading on first use) as one line: unit, id, what, why not.
6. **Commit** with the subject the unit gives, a body that says what changed
   and why in prose, and the attribution line your own system reminder
   prescribes. One unit, one commit. Push after every commit once a remote
   exists.
7. **Tick** the unit in §1's index (Status column: `done <short sha>`), and
   when a phase's last unit lands, set the phase's row in the plan's
   Progress table to `done` with the commit range.

If a unit's steps prove wrong against the tree (a name differs, a
constraint bites), fix the tree, note the correction in `MILESTONES.md` §4
under "Contract corrections found while implementing" (the same heading
§2 and §3 use), and continue. Never edit `expected.json` to match kernel
output; never edit an applied migration.

### 0.3 Rules that never bend

- `CLAUDE.md` non-negotiables, all of them. Money and rates are decimal
  strings at every boundary; the ONLY `Number(` on a value is
  `app/(app)/_charts/coordinate.ts`.
- Forward migrations only, and this milestone's are read views and function
  bodies (decision 52). Apply with `supabase migration up --local`; a draft
  you must re-run: `supabase migration repair --status reverted <version>`
  then `up` again. Every new function: `revoke all … from public, anon,
service_role` by name unless the service role is the intended caller.
- New dependencies are exactly: `recharts` (prod), `@playwright/test`
  and `prettier` (dev). Nothing else, whatever a problem seems to need. No
  major version bumps.
- Every `(app)` page and action calls `requireUser()` first. `getSession()`
  never. Service-role client only in `app/api/cron/**` and `lib/jobs/**`.
- Logs and error messages: ids, counts, codes, durations, variable
  _names_. Never a value, never a URL with a token.
- Nothing in `app/` or `lib/` names a pack, a currency or a locale outside
  `lib/settings/defaults.ts` (and locale literals in `lib/copy/index.ts`).
  The neutrality test (P0-U4) enforces it; do not add an allowlist entry
  to make a unit pass.
- No tax, no fiscal, no broker, no OAuth, no signup, no analytics.
- Do not touch another session's uncommitted files; `git status` before
  each unit.

### 0.4 Maintainer touchpoints — what to do when nobody answers

Four steps need the maintainer. None of them blocks the rest; each has a
fallback so the run continues end to end.

| Touchpoint                                               | Unit  | Fallback when no answer arrives                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M-1 Git remote** — the repository must exist on GitHub | P1-U1 | If `gh auth status` succeeds, ask once for consent to run `gh repo create finance-finder --private --source=. --remote=origin --push`; run it on a yes. Otherwise finish P1-U1's workflow changes, verify each job's commands locally, mark the unit `done (CI unverified)` and continue. Re-check `git remote -v` at the start of every later phase; the first green run closes the item. |
| **M-2 Review gate** after Phase 2 (decision 39)          | P2-U6 | Produce the screenshots, post the summary and the paths, and wait if the session is interactive. If no reply is possible, continue to Phase 3: the SPEC §10 tokens mean a later direction change is one stylesheet edit, and Phase 5 restyles the ledger screens anyway. Record "gate passed by default" in the unit's tick.                                                               |
| **M-3 `supported` status** (decision 41)                 | P8-U1 | Flip the two manifests yourself when every PACKS §12 criterion is met and list the evidence in the commit body; the maintainer's merge is the approval.                                                                                                                                                                                                                                    |
| **M-4 Deploy accounts** (decision 43)                    | P9-U1 | Cannot be done alone. Deliver `docs/DEPLOY.md`, `.env.example`, a green `release:check`, and the hand-off note in §3. Stop there.                                                                                                                                                                                                                                                          |

### 0.5 Tracking

- §1's index is the live status. Update it in the same commit as the unit.
- The plan's Progress table is per phase.
- Blocked items go in §1's "Blocked" list at the bottom of the index with
  the reason and what would unblock them.

### 0.6 Naming used below

- `Db` = `SupabaseClient<Database>` (from P1-U3 on; before it, the untyped
  `SupabaseClient`).
- "The gate" = the commands in §0.2 step 4.
- "Text-cast" = every numeric column selected as `col::text`.
- "Paginated" = read through `readAll` from `lib/supabase/paginate.ts`, every
  filter before `.range()`, ordered by key.
- Copy: every string a person reads comes from `copyFor(locale)` (P1-U7 on).

## 1. Unit index

| Unit  | Title                                                                   | Depends on   | Status               |
| ----- | ----------------------------------------------------------------------- | ------------ | -------------------- |
| P0-U1 | Docs baseline: ARCHITECTURE §3, PACKS §5/§15/§16                        | —            | done `02b9cb4`       |
| P0-U2 | Stories US-009–US-014 and personas                                      | —            | done `57453cd`       |
| P0-U3 | Dependencies: Recharts, Playwright, e2e tier                            | —            | done `bc78150`       |
| P0-U4 | Neutrality: `INSTANCE_DEFAULTS`, the test, the lint changes             | —            | done `bc8a414`       |
| P0-U5 | `br.stock`: kind, fixtures, golden row                                  | P0-U4        | done `46c0c32`       |
| P1-U1 | Remote and CI (M-1)                                                     | —            | done `3420c29`       |
| P1-U2 | Prettier and dependency currency                                        | P1-U1        | done `04b23cc`       |
| P1-U3 | Typed client and `lib/env.ts`                                           | P1-U2        | done `78bd5ff`       |
| P1-U4 | Security headers and nonce CSP                                          | P1-U3        | done `a5e6a5f`       |
| P1-U5 | Reads and jobs: helpers, views, bounded reads, chunked writes, run logs | P1-U3        | done `49d01b9`       |
| P1-U6 | Restore hardening                                                       | P1-U5        | done `50087be`       |
| P1-U7 | Copy in two languages, test utilities, doc drift, one-factor rule       | P1-U3        | done `f90cb0e`       |
| P1-U8 | Coverage thresholds                                                     | P1-U7        | done `498004f`       |
| P2-U1 | Tokens, fonts, theme and `lang`                                         | P1-U8        | done `903d8f8`       |
| P2-U2 | `lib/format`                                                            | P2-U1        | done `78f9af2`       |
| P2-U3 | Shell: nav, toggles, privacy mode, loading/error                        | P2-U2        | done `fe782c2`       |
| P2-U4 | Status strip and Refresh                                                | P2-U3        | done `2977827`       |
| P2-U5 | Overview and the first-run card                                         | P2-U4        | done `419c2bb`       |
| P2-U6 | Review gate (M-2)                                                       | P2-U5        | done `42cf33a`       |
| P3-U1 | Snapshot readers and `seriesReturn`                                     | P2-U6        | done `aa6014d`       |
| P3-U2 | Performance                                                             | P3-U1        | done `311e4e5`       |
| P3-U3 | Allocation                                                              | P3-U1        | done `(this commit)` |
| P4-U1 | Contribution and attribution drill-in                                   | P3-U1        | not started          |
| P4-U2 | Maturities                                                              | P3-U1        | not started          |
| P5-U1 | Schema-driven fields and the asset form                                 | P2-U6        | not started          |
| P5-U2 | Assets, Transactions and Import designed                                | P5-U1        | not started          |
| P5-U3 | Cash flows, Settings, Login/MFA/reset designed                          | P5-U1        | not started          |
| P6-U1 | Synthetic ledger and performance budgets                                | P4-U2, P5-U3 | not started          |
| P7-U1 | Smoke journeys, including the security-boundary journey                 | P6-U1        | not started          |
| P7-U2 | Accessibility pass                                                      | P7-U1        | not started          |
| P8-U1 | Fixtures re-recorded; packs `supported` (M-3)                           | P7-U2        | not started          |
| P8-U2 | Deploy runbook, `.env.example`, release gate green                      | P8-U1        | not started          |
| P9-U1 | First deploy with the maintainer (M-4)                                  | P8-U2        | not started          |

**Blocked:** (none yet)

## 2. Units

---

### P0-U1 — Docs baseline

**Goal.** The design documents say what the confirmed decisions say, before
any code is written against them.

**Read first.** `ARCHITECTURE.md` §3, §5, §8; `PACKS.md` §5, §15; the plan's
"Neutrality: the multi-country seam" and D-24; `packs/br/README.md` Quirks.

**Steps.**

1. `ARCHITECTURE.md` §3: rewrite the table to the installed truth. Rows:
   Styling → "plain CSS on the SPEC §10 tokens + CSS Modules (decision 47);
   no utility framework, no component library"; Database & auth →
   `@supabase/supabase-js` 2.116 + `@supabase/ssr` 0.12.7 installed; Charts →
   Recharts _installed in Milestone 4 Phase 0, exact-pinned_; Date math →
   "UTC helpers in `lib/calc/dates.ts`; no date library"; Forms → "native
   `<form action>` + server actions + zod (decision 48)"; Testing → "Vitest 5
   - fast-check 4 + Playwright (`pnpm test:e2e`, Milestone 4); no React
     Testing Library (decision 50)"; add rows Formatter → Prettier (decision
   50. and Security headers → nonce CSP from `proxy.ts` (decision 51). Keep
       the two bold rules and add: "Milestone 4 added `recharts`,
       `@playwright/test` and `prettier`; anything further is a decision."
2. `ARCHITECTURE.md` §5: replace `(dashboard)/ (planned)` with `(app)/` as it
   exists (list today's routes plus the five analysis routes marked
   _Milestone 4_), remove _(planned)_ from `login/` and `lib/supabase/`,
   add `lib/auth`, `lib/ledger`, `lib/jobs`, `lib/csv`, `lib/import`,
   `lib/backup`, `lib/testing`, `proxy.ts`. Mark `lib/database.types.ts`
   "generated; committed from Milestone 4 Phase 1".
3. `PACKS.md` §5: after the strategy table add one sentence: "An instrument
   kind whose `metadataSchema` includes `maturity: IsoDate` is treated as a
   fixed-income holding by the Maturities screen (MILESTONES §4 decision
   38); the kernel never reads it (§2 decision 14)."
4. `PACKS.md` §15: replace the "UI string translation" bullet with: "UI
   copy is kernel-owned: `lib/copy/<locale>.ts` dictionaries sharing one
   `Copy` type, selected by `user_settings.locale` (MILESTONES §4 decision
   34). A pack's `locale` field drives number and date formatting only. A
   new language is a new dictionary file, contributed like a pack but
   reviewed as kernel."
5. `PACKS.md` §16 "What the second pack will meet" — a checklist, each item
   one line with the decision that made it: base-currency-only cash flows
   (§3 d.25); USD-pivot FX triangulation with one `fx_rate` series
   (`lib/calc/fx.ts`); the snapshot calendar is the union of holdable
   packs' business days (§3 d.21); the `maturity` convention (§4 d.38);
   `curve_mark_to_market` without `indexation` (§2 d.7); rate series only
   exercised on `BUS/252` (§2 d.13); staleness windows from
   `stalenessWindowDays` over the pack calendar; the "two calendars per
   pack" question (D-24: B3 closes 24/31 Dec, ANBIMA publishes CDI — the
   same split as LSE vs UK bank holidays) is a `PACK_API_VERSION` question
   the canary answers; the neutrality test (§4 d.42) is the proof nothing
   else was assumed. End with: "Milestone 5 ticks each item with the UK
   golden fixture."
6. `CLAUDE.md` "Current state": one paragraph — Milestone 4 in progress,
   plan and runbook paths, decisions 33–52 confirmed; fix the sentence that
   still says "Next: Milestone 4 (UK pack canary) and 5 (the ten designed
   screens)". Add the `lib/copy`, `lib/format`, `lib/settings` and
   `app/(app)/_charts` lines to the Layout block as they arrive (do it now,
   marked _Milestone 4_).

**Tests.** None (docs). `pnpm test:packs` still green (README parsing).

**Done when.** `grep -n "planned" ARCHITECTURE.md` shows no row that
decisions 47–50 reversed; `PACKS.md` has §16; `grep -n "UK pack canary"
CLAUDE.md` is empty.

**Gate & QA.** Gate. `/qa-spec-fidelity ARCHITECTURE.md PACKS.md CLAUDE.md
against MILESTONES.md §4 decisions 34, 38, 45, 47–51`.

**Commit.** `Milestone 4 Phase 0: design docs say what decisions 33–52 say`

---

### P0-U2 — Stories and personas

**Goal.** `specs/SPEC.md` has US-009 to US-014 with acceptance criteria that
every later `/qa-spec-fidelity` run cites; `specs/PERSONAS.md` has no
placeholder.

**Read first.** `specs/SPEC.md` whole (US-003–US-008 are the style to match);
`specs/PERSONAS.md`; `SPEC.md` §9–§12; `scripts/check-release-readiness.ts`
lines 63–68 (the placeholder regex the file must not match).

**Steps.**

1. Append the six stories in the existing format (As a / I want / So that,
   AC list with `[ ]`, Test Scenarios, Priority Must Have, Status Planned).
   Use these acceptance criteria verbatim, adding the SPEC citation each
   names:
   - **US-009 See my portfolio at a glance** (Overview; SPEC §9 screen 1,
     §9.2, §9.3, §9.5). AC-009.1 `/` renders the §9.2 nav — Analysis and
     Ledger groups always visible, theme toggle, sign out — a hairline
     beneath, and the status strip only when something is pending, each
     item linking to the screen that resolves it, Refresh its only control.
     AC-009.2 The §9.3 first-run card renders above the content from row
     counts on every render, disappears as steps complete, reappears if
     data is deleted; steps are never gated. AC-009.3 The headline is the
     kernel's confident total at today in the base currency
     (`valuePortfolio` over a latest-price ledger read); "—" with _N assets
     unpriced_ when no position is priced; stale and unpriced are never
     summed. AC-009.4 Day change from the last two snapshot totals, period
     change from the first total in range; signed, coloured, with an arrow;
     "History starts after tonight's snapshot." below two snapshots.
     AC-009.5 Sparkline of confident totals; allocation donut by instrument
     kind from today's holdings; top movers by per-asset day change.
     AC-009.6 Every value printed by `lib/format` from decimal strings per
     `user_settings.locale`; the only `Number(` on a value is in
     `app/(app)/_charts/**`. AC-009.7 Copy comes from `lib/copy` in the
     user's locale, English or pt-BR.
   - **US-010 Compare my return** (Performance; screen 2, §6, §9.5).
     AC-010.1 Period selector 1M / YTD / 1Y / All (All = from the first
     snapshot; default All when history is shorter than 1Y, else 1Y).
     AC-010.2 TWR over the period from snapshot confident totals and cash
     flows through `twr()` (start-of-day flows, §2 decision 1), skipped
     sub-periods listed; MWR through `mwr()`; a null figure shows its
     reason in copy. AC-010.3 The chart plots the portfolio's cumulative
     return (accent) against togglable `benchmark`-role series (muted),
     each point from `seriesReturn` at that snapshot date; the toggles come
     from the registry, no kind-specific code. AC-010.4 A nominal/real
     toggle uses the `deflator`-role series through `realReturn`; hidden
     when the user's packs register none. AC-010.5 §9.5 empty states
     verbatim for fewer than two snapshots and for no benchmark ingested.
     AC-010.6 A date with any stale row carries the stale mark in the
     tooltip; `prefers-reduced-motion` disables chart animation.
   - **US-011 See what I hold and what drove it** (Allocation, Contribution;
     screens 3–4, §6). AC-011.1 Allocation by instrument kind, by pack, by
     currency from the latest snapshot rows; native vs base exposure;
     percentages sum to exactly 100.00 after rounding (remainder to the
     largest slice). AC-011.2 Contribution bars per asset over the period
     from `contribution()`; a partial total is flagged with its reasons;
     the sum shown equals the simple return shown. AC-011.3
     `/contribution/[assetId]` shows `attribution()`'s R_native, R_fx and
     R_base with the identity stated; a base-currency asset shows R_fx = 0
     as a fact, not hidden. AC-011.4 §9.5 empty states verbatim.
   - **US-012 Know what matures when** (Maturities; screen 5; §4 decision
     38). AC-012.1 The ladder lists every held asset whose kind's
     `metadataSchema` has `maturity`, by date, with days to go, current
     value with its status mark, the contracted value at maturity for
     plain-rate accrual kinds (`valueHolding` at that date) and "final
     amount depends on the index" for indexed kinds. AC-012.2 A matured
     asset still held is marked "matured — record the redemption", never
     valued as if alive without saying so. AC-012.3 Timeline view grouped
     by month. AC-012.4 §9.5 empty state verbatim; detection reads the
     schema shape, never a kind id.
   - **US-013 Use it on my phone, in my theme, in front of others** (§10,
     §12.3, §9.5, §11, §9 screens 6–10). AC-013.1 `app/globals.css` defines
     exactly the §10 tokens for light and dark; `data-theme` on `<html>`
     from the user's setting with no flash; `system` follows
     `prefers-color-scheme`; the nav toggle persists the setting. AC-013.2
     Instrument Serif through `next/font` for display and large figures,
     the system sans stack elsewhere, tabular numerals on every figure.
     AC-013.3 Privacy mode: a toggle beside the theme switch, remembered in
     `localStorage`, masks every amount and quantity as `•••` through one
     `<Amount>` component; names, percentages and returns stay visible;
     nothing is sent to the server. AC-013.4 Every screen works at 400 px:
     the nav collapses to a menu, tables stack or scroll inside their own
     container, the page never scrolls horizontally. AC-013.5 Landmarks, a
     skip link, labelled controls, visible focus, `aria-live` on the
     strip, `loading.tsx` and `error.tsx` (fixed copy, no stack), AA
     contrast for every token pair in both themes, reduced motion
     respected. AC-013.6 `<ValueStatus>` marks carried-forward, stale and
     unpriced on every screen; an unpriced position never shows zero.
     AC-013.7 Assets, Transactions, Import, Cash flows, Settings, Login,
     MFA and reset are restyled on the tokens; the asset form is
     pack → kind → generated metadata fields → currency
     (`lib/forms/zod-fields.ts`); the JSON textarea is gone. AC-013.8
     Changing `locale` in Settings changes copy language and formatting;
     both dictionaries are complete (a test proves it).
   - **US-014 Run it in production** (§12, PACKS §12, ARCHITECTURE §8).
     AC-014.1 CI on the GitHub remote runs typecheck, lint, test,
     test:packs, test:db, format:check, audit, coverage thresholds, the
     `database.types.ts` diff, e2e and build, and is green on `main`.
     AC-014.2 Every response carries decision 51's headers; the CSP nonce is
     per request; the e2e journeys record zero CSP violations. AC-014.3
     `docs/performance-budgets.md` records `runSnapshots` ≥ 50 days/s and
     every screen read < 500 ms p50 on the synthetic five-year,
     twenty-asset ledger. AC-014.4 `pnpm test:e2e` passes the eight
     journeys of decision 46 plus the security-boundary journey of decision 40. AC-014.5 `packs/br` and `packs/global` are `supported` with
     fixtures ≤ 90 days old; `pnpm test:packs` reports one skip (`global`,
     no instruments). AC-014.6 `docs/DEPLOY.md` and `.env.example` are
     complete; `pnpm release:check` is green locally and in CI. AC-014.7
     The first deploy is recorded in `MILESTONES.md` §4 with both crons
     observed firing (maintainer).
2. Test Scenarios: three per story in the Given/When/Then style, drawn from
   the ACs (e.g. US-009: a fresh instance shows the four-step card; an
   instance with one unpriced asset shows "—" and the strip item; a
   restored ledger with snapshots shows day change with a sign).
3. Update "Out of Scope" (Milestone 4 specifics: no third language, no UK
   pack, no cached returns, no new tables), "Success Metrics" (rows for
   neutrality = 0 literals outside the allowlist, budgets, e2e, headers,
   coverage thresholds) and the Change Log.
4. `specs/PERSONAS.md`: replace every placeholder. Primary persona — the
   self-hosting Brazilian investor: holds Tesouro Direto, two or three CDBs,
   a handful of FIIs and ações, checks on a phone in the evening, medium
   tech comfort (can run `pnpm` once, will not debug), reads Portuguese
   first and English fine, wants one honest number and no surprise (a stale
   value shown as confident is the worst outcome). Goals, pain points,
   typical day, three scenarios (evening check on the phone; import a
   broker CSV after switching brokers; show the screen to a partner with
   privacy mode). Secondary persona — the pack contributor: a developer in
   another market who wants to add their country without touching math;
   scenarios: reads PACKS §16, runs conformance, sees their kind appear in
   the asset form with no UI change. Anti-personas: the tax filer (no
   fiscal figures, ever), the day trader (no intraday, no orders), the
   multi-tenant SaaS operator (single owner by posture). Persona Usage
   Guide stays.

**Tests.** `tsx scripts/check-release-readiness.ts` no longer lists
`specs/PERSONAS.md` (it still lists the draft packs).

**Done when.** Both files have no `[Persona Name`/`[Short Title` placeholders;
US-009–US-014 exist with the AC ids above; `pnpm test` green.

**Gate & QA.** Gate. `/qa-spec-fidelity specs/SPEC.md US-009–US-014 against
SPEC.md §9–§12 and MILESTONES.md §4 decisions 33–52 — check every AC cites
its section and contradicts no decision`.

**Commit.** `Milestone 4 Phase 0: stories US-009–US-014 and the personas`

---

### P0-U3 — Dependencies and the e2e tier

**Goal.** Recharts and Playwright installed, exact-pinned; `pnpm test:e2e`
exists as a tier that fails loudly without browsers; `release:check`
requires it.

**Read first.** `package.json`, `vitest.config.mts`, `vitest.db.config.mts`,
`ARCHITECTURE.md` §3 (as rewritten), `node_modules/next/dist/docs/` on
testing with Playwright.

**Steps.**

1. `pnpm add -E recharts` and `pnpm add -DE @playwright/test`, then
   `pnpm exec playwright install chromium`. Note the resolved versions in
   the commit body.
2. `playwright.config.ts`: `testDir: "e2e"`, `fullyParallel: false`
   (one shared database), `retries: 0`, `use.baseURL =
process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000"`,
   `reporter: "list"`, projects `desktop` (chromium, 1280×800) and `phone`
   (chromium, 400×800, `isMobile: true`), `webServer: { command:
process.env.CI ? "pnpm start" : "pnpm dev", url: baseURL + "/login",
reuseExistingServer: !process.env.CI, timeout: 120_000 }`.
   `globalSetup: "./e2e/setup.ts"` (a placeholder in this unit that only
   asserts the four env variables by name and the stack's reachability —
   reuse `requireDbEnv` and `assertStackReachable` from `lib/testing/db.ts`).
3. `e2e/smoke.spec.ts`: one test — `/login` renders the email field and no
   signup link. `e2e/README.md`: what the tier is, how to run it, that it
   never skips.
4. `package.json`: `"test:e2e": "playwright test"`; `release:check` gains
   `&& pnpm test:e2e` before `pnpm build`. `vitest.config.mts` excludes
   `e2e/**`. `tsconfig.json` includes `e2e/**/*.ts` (it already matches
   `**/*.ts`) — confirm `pnpm typecheck` types the spec.
5. `.gitignore`: `/test-results`, `/playwright-report`, `/docs/review`.

**Tests.** `pnpm test:e2e` passes the smoke test against the running dev
server; with `PLAYWRIGHT_BROWSERS_PATH=/nonexistent pnpm test:e2e` it fails
with Playwright's missing-browser error, not a pass.

**Done when.** `pnpm test`, `pnpm test:e2e`, `pnpm build` green;
`package.json` pins exact versions for the two packages.

**Gate & QA.** Gate + build. `/qa-code-quality playwright.config.ts e2e/
package.json`.

**Commit.** `Milestone 4 Phase 0: Recharts and Playwright, and the e2e tier`

---

### P0-U4 — Neutrality: defaults, the test, the lint changes

**Goal.** Exactly one module in `app/` and `lib/` names Brazil; a test says
so; the float ban covers the app with one documented exemption.

**Read first.** `app/layout.tsx`; `app/(app)/transactions/_form.tsx` and
`app/(app)/assets/_form.tsx` (the `?? "BRL"`); `app/(app)/transactions/import/
page.tsx` line ~110 (`native_currency: "BRL"`); `lib/ledger/rows.ts`
`readSettings` fallback; `lib/auth/security.ts` `signOut({ scope: "global" })`;
`eslint.config.mjs` whole; `packs/conformance/hygiene.test.ts` (how it walks
files).

**Steps.**

1. `lib/settings/defaults.ts`:
   ```ts
   /** The instance's defaults — the ONLY place app/ or lib/ may name a pack,
    *  a currency or a locale (MILESTONES §4 decision 42). These mirror the
    *  database defaults in the initial migration. */
   export const INSTANCE_DEFAULTS = {
     baseCurrency: "BRL",
     locale: "pt-BR",
     theme: "system",
     enabledPacks: [] as string[],
   } as const;
   ```
   Add a `lib/settings/README.md` of five lines saying why the file exists
   and that adding a second literal site is a decision.
2. Move the five literals behind it: `app/layout.tsx` `lang` (from the
   locale cookie, falling back to `INSTANCE_DEFAULTS.locale` — the cookie
   itself arrives in P2-U1; for now the default), the two form fallbacks,
   the import prefill, `readSettings`'s fallback row.
3. `packs/conformance/kernel-neutrality.test.ts`: walk `app/**` and `lib/**`
   for `.ts`/`.tsx`, skipping `*.test.ts`, `*.dbtest.ts`, `lib/testing/**`,
   `lib/database.types.ts`, `lib/settings/defaults.ts`, and `lib/copy/
index.ts` for locale literals only. Fail on any line matching
   `/["'](br|global)(\.[a-z_]+)?["']/` (pack ids and prefixed ids),
   `/["']BRL["']/`, `/["']pt-BR["']/` — except a line containing
   `scope: "global"` (Supabase's sign-out scope, not the pack id). The
   failure message lists file:line for every hit. Add the file to the
   conformance suite's expectations (it runs under `pnpm test:packs`).
4. `eslint.config.mjs`: extend the `floatBans` block to `app/**/*.{ts,tsx}`
   and `lib/**/*.ts`, ignoring `**/*.test.ts`, `**/*.dbtest.ts`,
   `lib/testing/**`, `scripts/**`, and `app/(app)/_charts/**` (comment:
   "the one documented boundary where a decimal string becomes a
   coordinate — decision 35"). Run `pnpm lint`; fix every hit outside the
   exemption (`parseInt` on a regex-validated integer such as a page number
   is the allowed form; a count is a `number` already).
5. Create `app/(app)/_charts/coordinate.ts` now, with the only `Number(`:
   `export function toCoordinate(value: string): number` with a doc comment
   citing decision 35, and a test that `toCoordinate("1.5") === 1.5` and that
   the file is the only one under `app/` and `lib/` source containing
   `Number(` (grep in the test, same walker as step 3).

**Tests.** The neutrality test (fails when you add `"BRL"` to any other
file — try it, then remove it); the coordinate test; existing suites.

**Done when.** `pnpm test:packs` includes and passes the neutrality test;
`pnpm lint` green with the widened ban.

**Gate & QA.** Gate + `test:packs`. `/qa-code-quality lib/settings
packs/conformance/kernel-neutrality.test.ts eslint.config.mjs app/(app)/_charts`.

**Commit.** `Milestone 4 Phase 0: one instance-defaults module and the neutrality test`

---

### P0-U5 — `br.stock`

**Goal.** A seventh BR kind, priced by brapi, with fixtures, a README row and
a golden row derived by the script.

**Read first.** `packs/br/instruments.ts`; `packs/br/sources/brapi.ts` whole;
`scripts/fixture-catalog.ts` (the `br.brapi` entry) and
`scripts/record-fixtures.ts`; `lib/packs/fixtures.ts`;
`packs/br/fixtures/portfolio.json` whole; `packs/br/fixtures/derive_expected.py`
whole; `packs/conformance/fixtures.test.ts`; `packs/br/README.md`;
`lib/calc/golden.ts` (`GoldenFixtureSchema`).

**Steps.**

1. `packs/br/instruments.ts`: add
   `{ id: "br.stock", label: "Ação / ETF / BDR (B3)", valuation: { kind: "market_price", sourceId: "br.brapi" }, metadataSchema: StockMetadata, identifier: "ticker", quoteCurrency: "BRL" }`
   with `const StockMetadata = z.object({ name: z.string().min(1) })` and a
   doc comment: BDRs are quoted in BRL over a foreign underlying, so the
   naive decomposition reports zero FX attribution (SPEC §11 known gap).
2. `brapi.ts`: confirm the quote path serves an equity ticker under the same
   endpoint and lexeme parsing (it does for FIIs; the adapter is
   symbol-agnostic — verify by reading, and if any FII-specific assumption
   exists, generalise it with a test).
3. `scripts/fixture-catalog.ts`: add to `br.brapi` `success` a `spot` case
   `refs: ["PETR4"]` (note: "spot: an equity ticker, the br.stock kind") and a
   `historical` case for it over the same fixed window the FII case uses;
   `empty` needs no new case unless the conformance test demands one per
   ref kind (it demands one per capability — check).
4. `pnpm fixtures:record --source br.brapi` with the live token from
   `.env.local`. Inspect the diff: redaction holds (no token anywhere:
   `grep -r "$BRAPI_TOKEN" packs/` must print nothing — run it without
   echoing the value), the FII and index cases still replay. Set
   `recordedAt` as the script does.
5. `portfolio.json`: asset `stk` (`br.stock`, `PETR4`, BRL, `{ name:
"Petrobras PN" }`), one `buy` on `2026-02-10` (quantity 100, price
   `38.20`, fees `4.90`), a deposit cash flow that day for the cost, prices
   on all six valuation dates (choose plausible values; they are fixture
   data, not market data — say so in `$comment`), and update the
   `$comment` counts (seven kinds, ten transactions, five cash flows).
6. `derive_expected.py`: register `"br.stock": ("market", None)` in the
   kinds map; run `python3 packs/br/fixtures/derive_expected.py`; commit
   the regenerated `expected.json`. Never edit it by hand.
7. `packs/br/README.md`: Coverage row for `br.stock` with the BDR note;
   Sources row for `br.brapi` mentions equities. `specs/SPEC.md` US-001
   scenario 1: seven kinds, ten transactions, five cash flows.
8. `pnpm test:packs`: conformance green with one skip (`global`).
   `pnpm test:calc` green. If `compareGolden` reports a mismatch, the bug is
   in the script or the kernel — rederive by hand, never edit the fixture.

**Tests.** Conformance (fixtures replay, golden match), `brapi.test.ts`
gains an equity spot case.

**Done when.** `pnpm test:packs` → 1 skip; `git diff --stat` shows
`expected.json` regenerated; the README row exists.

**Gate & QA.** Gate + `test:packs`. `/qa-spec-fidelity packs/br against
MILESTONES §4 decision 33 and PACKS.md §11.5` · `/qa-code-quality packs/br
scripts/fixture-catalog.ts`.

**Commit.** `Milestone 4 Phase 0: br.stock — kind, fixtures, golden row`

---

### P1-U1 — Remote and CI (M-1)

**Goal.** The workflow runs on GitHub on every push to `main`, and runs the
database tier.

**Read first.** `.github/workflows/ci.yml`; `vitest.db.config.mts`;
`lib/testing/db.ts` (`REQUIRED_ENV`); `supabase/config.toml` `[api]`,
`[auth]`; the local `supabase --version` and the variable names
`supabase status -o env` prints (record the names, not the values).

**Steps.**

1. Remote: `git remote -v`. If empty, apply M-1's fallback (§0.4). If a
   remote exists or is created, `git push -u origin main`.
2. `ci.yml`: keep job `check` as is. Add job `db` (needs nothing; runs in
   parallel): `actions/checkout@v4`, `pnpm/action-setup@v4`,
   `actions/setup-node@v4` (node 22, pnpm cache), `supabase/setup-cli@v1`
   pinned to the local CLI's major.minor, `pnpm install --frozen-lockfile`,
   `supabase start -x logflare,studio,vector`, then export the three
   variables by mapping `supabase status -o env`'s names to
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (write the mapping with the names you
   recorded; a `set -a; eval "$(supabase status -o env)"; set +a` followed
   by explicit `echo "NEXT_PUBLIC_SUPABASE_URL=$API_URL" >> "$GITHUB_ENV"`
   lines), `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000`, a throwaway
   `CRON_SECRET` generated in the job; then `pnpm test:db`; `always()`
   step `supabase stop`. Add step `pnpm audit --audit-level=high` to
   `check`.
3. Add a `concurrency` group per ref (cancel in progress) and
   `timeout-minutes: 20` on both jobs.
4. Push; watch the run (`gh run watch` if available). Fix until green.

**Tests.** The run itself.

**Done when.** A green run on `main` with both jobs, or the M-1 fallback
recorded in the index with "CI unverified".

**Gate & QA.** Gate locally. `/qa-code-quality .github/workflows/ci.yml`
(secrets: none in the file; the CRON_SECRET is generated, never stored).

**Commit.** `Milestone 4 Phase 1: CI runs on the remote, with the database tier`

---

### P1-U2 — Prettier and dependency currency

**Goal.** One formatter, checked in CI; every dependency at its latest
patch/minor; the policy written down.

**Read first.** `package.json`; a sample of long lines
(`lib/ledger/rows.ts`, `lib/ledger/queries.ts`) to choose the width;
`CLAUDE.md` non-negotiables (where the policy goes).

**Steps.**

1. `pnpm add -DE prettier`. `.prettierrc.json`: `{ "printWidth": 120,
"singleQuote": false, "trailingComma": "all", "semi": true }`.
   `.prettierignore`: `.next`, `node_modules`, `coverage`, `pnpm-lock.yaml`,
   `lib/database.types.ts`, `packs/*/fixtures/**`, `.github/CODEOWNERS`,
   `test-results`, `playwright-report`, `docs/review`.
2. Scripts: `"format": "prettier --write ."`, `"format:check": "prettier
--check ."`. `ci.yml` `check` gains `pnpm format:check` after lint.
3. Run `pnpm format` and commit **only** the formatting as its own commit
   (`Milestone 4 Phase 1: one formatting-only commit (Prettier)`), gate
   green before and after.
4. Second commit: `pnpm outdated`; bump every patch and minor
   (`pnpm add -E next@16.3.x eslint-config-next@16.3.x react@19.3.x
react-dom@19.3.x`, `pnpm update` for the caret ranges — vitest,
   @vitest/coverage-v8, fast-check, tsx, @types/*). No major. Run the full
   gate and `pnpm build`. If a bump breaks something, pin the previous
   version for that package and record why in the commit body.
5. `CLAUDE.md` non-negotiables gains: "Dependencies: patch bumps freely,
   minor bumps under the full gate, major bumps are a recorded decision;
   `pnpm outdated` at the start of every milestone."

**Tests.** Existing suites; `pnpm format:check` clean.

**Done when.** `pnpm outdated` prints nothing but majors; two commits; CI
green.

**Gate & QA.** Gate + build. `/qa-code-quality package.json .prettierrc.json`.

**Commit.** (two) `Milestone 4 Phase 1: one formatting-only commit (Prettier)`
then `Milestone 4 Phase 1: dependencies current, currency policy recorded`

---

### P1-U3 — Typed client and `lib/env.ts`

**Goal.** Every Supabase client is `SupabaseClient<Database>`; the nine row
casts are gone or justified; environment is validated once per runtime with
variable names in the error.

**Read first.** `lib/supabase/{env,server,service}.ts`; `lib/auth/session.ts`;
`lib/testing/db.ts`; `proxy.ts`; every `as XRow` (`grep -rn "as [A-Z][A-Za-z]*Row\b" lib app`);
`lib/ledger/rows.ts` (the `::text` selects); `lib/cron/auth.ts`;
`scripts/bootstrap-user.ts` (reads env itself; leave it).

**Steps.**

1. Stack up; `pnpm db:types` → `lib/database.types.ts`. Commit it. Add to
   `ci.yml` `db` job, after `supabase start`: `pnpm db:types && git diff
--exit-code lib/database.types.ts` (message in the step name: "types
   drifted — run pnpm db:types").
2. `lib/supabase/types.ts`: `export type Db = SupabaseClient<Database>`.
   `createServerSupabase(): Promise<Db>` via `createServerClient<Database>`;
   `createServiceRoleClient(): Db` via `createClient<Database>`;
   `lib/testing/db.ts` the same; `Session.client: Db`; every function that
   takes `client: SupabaseClient` takes `Db` (ledger, jobs, packs store,
   import loader, actions, pages, `lib/auth/security.ts`).
3. Remove each `as XRow` where the typed select now types the row. For a
   `::text` select the parser types the column as `string`; where it does
   not, keep the explicit row interface and apply it with
   `.overrideTypes<T[]>()` (Supabase's documented escape), with a one-line
   comment naming the column. Run `pnpm typecheck` after each file.
4. `lib/env.ts`: three zod objects — `PublicEnv` (`NEXT_PUBLIC_SUPABASE_URL`
   `z.url()`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` `z.string().min(1)`,
   `NEXT_PUBLIC_SITE_URL` `z.url()`), `ServerEnv` (`SUPABASE_SERVICE_ROLE_KEY`
   `z.string().min(1)`), `CronEnv` (`CRON_SECRET` optional string — the
   32-byte rule stays in `lib/cron/auth.ts`, which must keep failing closed
   rather than throwing). Each exported reader (`publicEnv()`, `serverEnv()`,
   `cronEnv()`) parses once and memoises; on failure throws
   `Error("env: missing or invalid <NAMES>")` — names only. Read
   `process.env.NEXT_PUBLIC_*` as literal property accesses (Next inlines
   them by name). `siteUrl()` moves here (trailing slash stripped).
5. Delete `lib/supabase/env.ts`; `server.ts`, `service.ts`, `proxy.ts`,
   `app/login/actions.ts` (reset link) and any other importer read through
   `lib/env.ts`.

**Tests.** `lib/env.test.ts`: a missing variable throws naming it and no
other; a valid set parses once (spy on the parse); the message never
contains a value (construct a distinctive fake value and assert its
absence). Existing suites green.

**Done when.** `grep -rn "as [A-Z][A-Za-z]*Row\b" lib app` lists only lines
with the `overrideTypes` comment; `grep -rn "SupabaseClient\b" lib app
proxy.ts` shows only the `Db` alias definition; `pnpm typecheck` green; CI
types step green.

**Gate & QA.** Gate. `/qa-code-quality lib/env.ts lib/supabase lib/auth/session.ts
lib/ledger lib/jobs lib/packs/store.ts` (secrets scan: names only).

**Commit.** `Milestone 4 Phase 1: typed Supabase client and one env module`

---

### P1-U4 — Security headers and nonce CSP

**Goal.** Decision 51 on every response; the nonce reaches Next's own
scripts and the one inline boot script the theme needs later.

**Read first.** `next.config.ts`; `proxy.ts` whole (how `response` is rebuilt
inside `setAll`); `node_modules/next/dist/docs/` — the guide on Content
Security Policy and on `proxy`; `app/layout.tsx`; `app/(app)/settings/
totp-enrol.tsx` (the QR is a data URI — `img-src` must allow `data:`).

**Steps.**

1. `lib/security/csp.ts`: `buildCsp(nonce: string, opts: { dev: boolean }):
string` returning `default-src 'self'; script-src 'self' 'nonce-<n>'
'strict-dynamic'[ 'unsafe-eval' in dev]; style-src 'self'
'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src
'self'[ ws: in dev]; frame-ancestors 'none'; base-uri 'self';
form-action 'self'; object-src 'none'[; upgrade-insecure-requests outside
dev]`. `newNonce()` = 16 random bytes, base64.
2. `proxy.ts`: generate the nonce first; build the forwarded request headers
   with `x-nonce`; every `NextResponse.next({ request: { headers } })` (the
   initial one and the one rebuilt in `setAll`) carries them; set
   `Content-Security-Policy` on the final response and on the redirect.
   Keep the matcher (cron routes stay out — they return JSON).
3. `next.config.ts`: `poweredByHeader: false`; `headers()` for `/(.*)`:
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
   `Permissions-Policy: camera=(), microphone=(), geolocation=(),
payment=(), usb=()`, `X-Frame-Options: DENY`, and in production
   `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
4. `app/layout.tsx`: read the nonce with `(await headers()).get("x-nonce")`
   and keep it available (P2-U1 uses it for the boot script). Nothing
   inline yet.
5. `pnpm dev`; open every route signed out and signed in; the browser
   console shows no CSP violation; `curl -sI http://127.0.0.1:3000/login`
   shows every header. Try the TOTP enrolment QR renders.

**Tests.** `lib/security/csp.test.ts`: the directive set for dev and prod
(exact strings); the nonce is base64 of 16 bytes and differs per call.
`proxy.test.ts` if a pure `applySecurityHeaders(response, nonce)` helper is
extracted — extract it, test it.

**Done when.** Headers present on `/login`, `/`, `/settings`, the export
route; no console violation on any page; build green.

**Gate & QA.** Gate + build. `/qa-code-quality lib/security proxy.ts
next.config.ts` · `/qa-spec-fidelity proxy.ts next.config.ts against
MILESTONES §4 decision 51`.

**Commit.** `Milestone 4 Phase 1: security headers and a per-request CSP nonce`

---

### P1-U5 — Reads and jobs

**Goal.** D-09 to D-14, D-18, D-19 closed: shared helpers, two read views,
bounded reads, chunked writes, run logs.

**Read first.** `lib/packs/ingest.ts` (its `addDays`, the source ordering
around line 158–180); `lib/calc/dates.ts` `addDays`;
`lib/jobs/snapshots-store.ts`; `lib/jobs/snapshots.ts`; `lib/packs/store.ts`
`listAssets`; `lib/ledger/rows.ts` whole; `app/(app)/transactions/import/
load.ts`; `lib/import/dryRun.ts` (`KnownTransaction`); `app/api/cron/
{prices,snapshots}/route.ts` and their tests; `lib/packs/redact.ts`;
`supabase/migrations/20260920210000_ledger_reads.sql` (the view pattern).

**Steps.**

1. **D-09** `ingest.ts`: delete its `addDays`, import from `@/lib/calc/dates`
   (that direction — runtime importing kernel — is allowed). Both are UTC
   day arithmetic; `ingest.test.ts` proves nothing moved.
2. **D-10** `lib/util/order.ts`: `nullsFirst<T>(key: (t: T) => string | null,
then: (a: T, b: T) => number): (a: T, b: T) => number`. Use it in
   `listUsers` and in the ingest source ordering. Test: nulls first, then
   key ascending, then the tiebreak.
3. **D-11 + Overview's need** — migration `supabase/migrations/
<timestamp>_snapshot_views.sql` (`date +%Y%m%d%H%M%S`, later than
   `20260920230000`):
   - `snapshot_markers` `with (security_invoker = true)`: per
     `user_settings.user_id`, `max(portfolio_snapshots.date)` as
     `last_snapshot_date`, `min(transactions.trade_date)` as
     `earliest_trade_date` (left joins or scalar subqueries; one row per
     user). Grant select to `authenticated` (the strip reads its own row in
     P2-U4; the service role reads all).
   - `snapshot_totals` `with (security_invoker = true)`: per `(user_id,
date)`: `sum(market_value_base) filter (where status in ('ok',
'carried_forward'))::text as total_base`, `count(*) as rows`,
     `count(*) filter (where status = 'stale') as stale_rows`,
     `count(*) filter (where carried_forward) as carried_rows`,
     `base_currency` (max — it is uniform per user per date). Grant select
     to `authenticated`.
   - Comments on both views; apply with `supabase migration up --local`;
     `pnpm db:types` and commit the regenerated file.
     `listUsers` becomes one paginated read of `snapshot_markers` (filtered
     by `scope.userIds` when given, before `.range()`), ordered by
     `last_snapshot_date` nulls first then `user_id` — order in SQL
     (`.order("last_snapshot_date", { ascending: true, nullsFirst: true })`)
     and keep `nullsFirst` as the in-memory guarantee for the fake store.
4. **D-12** `store.ts` `listAssets` `unpriced`: replace the price-row diff
   with a chunked read of `asset_latest_prices` (`asset_id` only, `.in(…)`
   per 500 ids); priced = present. Delete the "should become a view"
   comment; explain the view.
5. **D-13** `readLedger` options: `pricesFrom?: IsoDate` (`.gte("date",
pricesFrom)` on the price read) and `prices?: "all" | "latest"` —
   `"latest"` reads `asset_latest_prices` (text price) instead of the
   `prices` table and is documented as valid only for a valuation at a
   date ≥ every latest price date (today). The snapshot job keeps `"all"`
   with `pricesFrom = marker − window` where `window` is
   `stalenessWindowDays` over the widest pack calendar + `NAV_EXTRA_DAYS`
   — compute it in `snapshots.ts` from `tradingCalendars(read)`; if the
   marker read cannot know the calendars before reading, read assets
   first, then prices (two steps; document). The golden dbtest must still
   match `expected.json`.
6. **D-14** `load.ts`: after `resolveColumns`, compute `[min, max]` of the
   parsed rows' date column (raw strings compared after `IsoDateSchema`
   validation; rows with an invalid date are excluded from the bound and
   flagged by the dry run as before); read `transactions` with
   `.gte("trade_date", min).lte("trade_date", max)` before `.range()`.
   Empty file → no read.
7. **D-18** `writeDay`: upsert in chunks of 500 rows (`PAGE_SIZE`), in
   order. Header comment: a chunked day can be partially written on a
   crash; the marker is `max(date)`, so the next run rebuilds that day
   whole (the upsert is idempotent). `lib/jobs/README.md` says the same.
8. **D-19** both cron routes: after computing the summary, `console.log(
JSON.stringify({ job: "prices" | "snapshots", ...summary }))` — the
   summary is already counts and codes; the route tests assert the logged
   line contains no `http`, no token-shaped string and no key named
   `value`/`price`/`quantity`.

**Tests.** `order.test.ts`; `snapshots.dbtest.ts` gains: `listUsers` over
three users (none, old, recent snapshots) orders nulls first and reads one
page; `snapshot_totals` sums only `ok` + `carried_forward` and flags a
stale date; `store.dbtest.ts` `unpriced` still excludes priced assets;
`rows.test.ts` with the fake client: `pricesFrom` filters, `"latest"` reads
the view; `import.test.ts`: the bound excludes invalid dates; route tests
for the log line. Golden dbtest unchanged and green.

**Done when.** `grep -n "limit(1)" lib/jobs/snapshots-store.ts` is empty; the
migration is applied; `database.types.ts` includes both views; all gates
green.

**Gate & QA.** Gate. `/qa-code-quality lib/util lib/jobs lib/packs/store.ts
lib/ledger/rows.ts app/(app)/transactions/import/load.ts app/api/cron
supabase/migrations/<new>` · `/qa-spec-fidelity against plan D-09–D-14,
D-18, D-19 and MILESTONES §4 decision 52`.

**Commit.** `Milestone 4 Phase 1: bounded reads, snapshot views, chunked writes, run logs`

---

### P1-U6 — Restore hardening

**Goal.** `restore_backup` refuses invalid rows with a fixed reason and
serialises concurrent restores per user.

**Read first.** `supabase/migrations/20260920200000_backup_rpcs.sql` whole;
`lib/backup/restore.ts`; `lib/backup/roundtrip.dbtest.ts`; `app/(app)/
settings/actions.ts` `restoreBackupAction`; the `RESTORE_COPY` map.

**Steps.**

1. Migration `<timestamp>_restore_hardening.sql`: `create or replace
function public.restore_backup(payload jsonb)` restating the whole body
   (function bodies are allowed, decision 52) with two changes: after the
   `not_authenticated` check, `perform pg_advisory_xact_lock(hashtext(
v_uid::text));` (a comment: two concurrent restores into one empty
   account both passed the emptiness check; the lock serialises them so
   the second sees `account_not_empty`); and an `exception` block that
   catches only the data and integrity classes — `when check_violation or
not_null_violation or foreign_key_violation or unique_violation or
invalid_text_representation or numeric_value_out_of_range or
datetime_field_overflow or invalid_datetime_format then raise exception
'restore_refused: invalid_rows'` — so the function's own
   `restore_refused: …` raises pass through untouched. Re-apply the
   revoke/grant lines exactly as the original.
2. `lib/backup/restore.ts` (or wherever the reason is mapped): add
   `invalid_rows` to the closed set; Settings copy gains the line
   ("The file has a row the database refuses (a negative price, an unknown
   type). Fix the export and retry.").
3. Apply, `pnpm db:types`, commit the types.

**Tests.** `roundtrip.dbtest.ts` gains: (a) a payload with `unit_price:
"-1"` → the RPC error message is `restore_refused: invalid_rows` and every
user table stays empty; (b) two signed-in clients for the same throwaway
user call `restore_backup` in `Promise.all` with the same valid payload —
exactly one succeeds, the other fails with `account_not_empty`, and the
final row counts equal one restore.

**Done when.** Both cases pass; the original round-trip and ownership
cases unchanged.

**Gate & QA.** Gate. `/qa-code-quality supabase/migrations/<new>
lib/backup/restore.ts` · `/qa-spec-fidelity against plan D-16, D-17 and
SPEC §12.3 refusal codes`.

**Commit.** `Milestone 4 Phase 1: restore refuses invalid rows and serialises concurrent restores`

---

### P1-U7 — Copy in two languages, test utilities, doc drift, one-factor rule

**Goal.** One `Copy` type, two complete dictionaries, `copyFor(locale)`; the
shared strings moved; `fake-client.ts` under `lib/testing`; three doc lines
fixed; a second TOTP enrolment refused while one is verified.

**Read first.** `app/(app)/_lib/form.ts` (`REASON_COPY`); `app/(app)/settings/
page.tsx` (the three maps); `app/(app)/transactions/import/page.tsx` (its
`COPY`); `lib/ledger/result.ts` (`ActionReason`); `lib/auth/security.ts`
(`SecurityReason`, `enrolTotp`); `lib/backup/restore.ts` (refusal codes);
`lib/import` (dry-run error codes); `app/(app)/layout.tsx`, `app/login/**`
(strings); `lib/ledger/fake-client.ts` and its importers; `lib/auth/README.md`;
`SPEC.md` §12.1 table; `README.md` "Privacy & trust"; the plan "Production"
paragraph ("nine migrations").

**Steps.**

1. `lib/copy/types.ts`: `interface Copy` with nested groups — `nav`
   (route labels, sign out, theme, privacy), `login` (fields, the one
   bootstrap line, uniform failure, reset messages, MFA), `reasons:
Record<ActionReason, string>`, `security: Record<SecurityReason |
"factor_exists", string>`, `restore: Record<RestoreReason | "done" |
"no_file" | "invalid_backup", string>` (`RestoreReason` = the refusal
   union `lib/backup/restore.ts` exports, whatever its name), `delete`, `import` (the existing
   keys), `status` (strip items; P2-U4 fills), `empty` (SPEC §9.5 rows;
   P2–P5 fill), `firstRun` (§9.3 rows; P2-U5), `screens` (one group per
   screen, filled as designed). Every leaf is a `string` or a function of
   named parameters `(p: { n: number }) => string` for counts.
2. `lib/copy/en.ts` — the English text exactly as SPEC quotes it where SPEC
   quotes it; `lib/copy/pt-BR.ts` — the same keys in Brazilian Portuguese
   (formal-neutral "você", finance vocabulary as Brazilian brokers use it:
   "cotação", "resgate", "aporte", "carteira"). `lib/copy/index.ts`:
   `LOCALES = ["en", "pt-BR"] as const`, `copyFor(locale: string): Copy`
   (exact match, else `en`), `isSupportedLocale`. This file is on the
   neutrality allowlist for locale literals only.
3. Move the four maps and the import `COPY` into the dictionaries; the
   pages call `copyFor(settings.locale)` (unauthenticated pages:
   `copyFor(INSTANCE_DEFAULTS.locale)` until P2-U1's cookie). Delete the
   old maps.
4. `lib/copy/copy.test.ts`: the two dictionaries have identical deep key
   sets; no leaf is empty; every `ActionReason`, `SecurityReason`, restore
   code and import error code (enumerate them from their source types via
   a `satisfies Record<…, string>` on each group and a runtime list) has a
   line in both.
5. **D-20** `git mv lib/ledger/fake-client.ts lib/testing/fake-client.ts`;
   update importers. `lib/calc/valuation/testkit.ts` stays (see the plan's
   amended D-20).
6. **D-21** `SPEC.md` §12.1: remove AwesomeAPI from the sources cell;
   `README.md` "Privacy & trust": the export/restore/delete sentence now
   says they exist and points at Settings and `pnpm test:db`; the plan's
   "Production" paragraph: "every migration" instead of "the nine".
7. **D-22** `enrolTotp`: if `listFactors()` shows a verified `totp` factor,
   return `{ ok: false, reason: "factor_exists" }` before enrolling
   (unverified leftovers are still cleared as today). `lib/auth/README.md`
   gains "One factor per owner" with the reason (the challenge reads
   `totp[0]`). Settings shows the copy line.

**Tests.** `copy.test.ts`; `security.test.ts` gains the `factor_exists`
case with the fake auth; existing action tests updated for the moved
imports.

**Done when.** `grep -rn "_COPY\b" app` is empty; `lib/copy/pt-BR.ts` exists
and the completeness test passes; `lib/ledger/fake-client.ts` is gone.

**Gate & QA.** Gate. `/qa-code-quality lib/copy lib/auth/security.ts
lib/testing/fake-client.ts` · `/qa-spec-fidelity lib/copy against MILESTONES
§4 decision 34 and SPEC §9.5/§9.6 wording`.

**Commit.** `Milestone 4 Phase 1: copy in English and pt-BR, test utilities, doc drift, one factor`

---

### P1-U8 — Coverage thresholds

**Goal.** Coverage is measured and enforced, ratcheting upward.

**Read first.** `vitest.config.mts`; Vitest 5 docs on
`coverage.thresholds` (per-glob keys, `autoUpdate`); `lib/calc/README.md`
"Tests".

**Steps.**

1. `vitest.config.mts` `test.coverage`: `provider: "v8"`, `include:
["lib/**"]`, `exclude: ["lib/testing/**", "lib/database.types.ts",
"**/*.test.ts", "**/*.dbtest.ts", "lib/calc/valuation/testkit.ts"]`,
   `reporter: ["text-summary", "lcov"]`, `thresholds: { "lib/calc/**":
{ lines: 95, branches: 95, functions: 95 }, "lib/{ledger,jobs,import,csv,
backup,packs,auth,copy,format,util,security,env}*/**": { lines: 85,
branches: 85, functions: 85 }, autoUpdate: true }`.
2. `"test:coverage": "vitest run --coverage"`; `ci.yml` `check` runs it
   instead of plain `pnpm test`.
3. Run it. Where a directory is below its threshold, write the missing
   tests (branches the property tests skip, error paths, the `overrideTypes`
   rows). If after a genuine effort a directory is still short, set that
   directory's threshold to the measured value rounded down and record the
   number and the gap in `MILESTONES.md` §4 "Advisories recorded";
   `autoUpdate` raises it as tests arrive.

**Tests.** The new ones. `pnpm test:coverage` green.

**Done when.** `pnpm test:coverage` passes thresholds; CI green with the
coverage step; `coverage/` is gitignored (it is).

**Gate & QA.** Gate + `test:coverage`. `/qa-code-quality vitest.config.mts
and the tests added`.

**Commit.** `Milestone 4 Phase 1: coverage thresholds, ratcheting — Phase 1 complete`

Then set Phase 1 to `done` in the plan's Progress table.

---

### P2-U1 — Tokens, fonts, theme and `lang`

**Goal.** SPEC §10 in `globals.css`, Instrument Serif self-hosted, the theme
and locale on `<html>` with no flash and no database read on public pages.

**Read first.** `app/globals.css`; `app/layout.tsx`; `SPEC.md` §10;
`ARCHITECTURE.md` §7; Next docs on `next/font/google` and on reading
`cookies()`/`headers()` in a layout; `app/(app)/settings/actions.ts`
`updatePreferencesAction`; `app/login/actions.ts` `signIn`.

**Steps.**

1. `globals.css`: `:root` with the nine §10 tokens for light, `[data-theme=
"dark"]` for dark, and `@media (prefers-color-scheme: dark) { :root:not(
[data-theme="light"]) {…} }` for `system`. Starting palette (P7-U2
   verifies AA and may adjust): light `--bg #FFFDF9`, `--bg-subtle #F5F1E9`,
   `--surface #FFFFFF`, `--border-hairline #E3DDD2`, `--text #1B1A17`,
   `--text-muted #625D55`, `--pos #1B6F47`, `--neg #A8261F`, `--accent
#B24E24`; dark `--bg #121211`, `--bg-subtle #1A1917`, `--surface #1F1E1B`,
   `--border-hairline #2F2D29`, `--text #ECE7DD`, `--text-muted #A59F94`,
   `--pos #63C48E`, `--neg #F07A70`, `--accent #E28B5B`. Type scale, spacing
   scale, `font-variant-numeric: tabular-nums` on `.figure`, hairline rule
   utility, focus-visible ring, `prefers-reduced-motion` reset. Remove the
   scaffold's `--background/--foreground`.
2. `app/layout.tsx`: `Instrument_Serif` (`weight: "400"`, normal + italic,
   `variable: "--font-display"`) and the system sans stack as
   `--font-body` (no Geist); `lang` and `data-theme` from the `ff-locale`
   and `ff-theme` cookies (validated against `LOCALES` and `"system" |
"light" | "dark"`, falling back to `INSTANCE_DEFAULTS`); a nonce'd inline
   boot script (nonce from `x-nonce`) that reads `localStorage["ff-privacy"]`
   and sets `data-privacy="on"` on `<html>` before paint. `<meta name=
"color-scheme">` per theme.
3. Cookies are written by server actions only: `updatePreferencesAction`
   sets both after saving; `signIn` reads the user's settings once after a
   successful sign-in and sets both; `signOut` clears them. Cookie options:
   `httpOnly: true` (only the server reads them), `sameSite: "lax"`, one
   year. `(app)/layout.tsx`
   renders from settings and, when a cookie disagrees, shows nothing
   different — the next action resyncs (documented in the layout).
4. `lib/settings/preferences.ts`: `THEMES`, `parseTheme`, `parseLocale`,
   cookie names — the one place the names live.

**Tests.** `preferences.test.ts` (parsing, fallbacks); `pnpm build`;
manual: switch theme in Settings → no flash on reload; `lang` follows the
locale.

**Done when.** `curl -s http://127.0.0.1:3000/login | grep -o 'lang="[^"]*"'`
prints the instance default; both themes render; Geist is gone.

**Gate & QA.** Gate + build. `/qa-spec-fidelity app/globals.css app/layout.tsx
against SPEC §10 and US-013 AC-013.1–2` · `/qa-code-quality app/layout.tsx
lib/settings`.

**Commit.** `Milestone 4 Phase 2: SPEC §10 tokens, Instrument Serif, theme and locale without a flash`

---

### P2-U2 — `lib/format`

**Goal.** Money, quantities, percentages and dates formatted from decimal
strings per locale, never through a float.

**Read first.** `lib/calc/decimal.ts` (`toDecimalString`, `parseDecimal`);
`lib/calc/money.ts`; the plan's "Formatting never goes through a float".

**Steps.**

1. `lib/format/separators.ts`: `separatorsFor(locale)` from
   `Intl.NumberFormat(locale).formatToParts(1234567.891)` → `{ group,
decimal }` (memoised per locale); `currencySymbolFor(locale, currency)`
   and its position from `formatToParts` with `style: "currency"` on `0`.
2. `lib/format/number.ts`: `formatDecimal(value: string, opts: { locale,
minFraction, maxFraction, sign?: "auto" | "always" })` — split the
   canonical decimal string on `.`, round the fraction with `KernelDecimal`
   (`toFixed(maxFraction, ROUND_HALF_EVEN)` then trim to `minFraction`),
   group the integer digits by hand (thousands, or the locale's grouping
   from `formatToParts`), prefix the sign. No `Number(`.
3. `lib/format/money.ts` `formatMoney(amount, currency, locale)` (2 decimals,
   symbol placed per locale, non-breaking space where the locale puts one);
   `lib/format/quantity.ts` `formatQuantity(q, locale)` (up to 10 decimals,
   trailing zeros trimmed, at least 0); `lib/format/percent.ts`
   `formatPercent(unitRate, locale, { sign: "always" })` (unit rate → `×100`
   via `KernelDecimal`, 2 decimals, `%` per locale); `lib/format/date.ts`
   `formatDate(iso, locale, style: "short" | "long")` through
   `Intl.DateTimeFormat` with `timeZone: "UTC"` on the ISO date (a date,
   not an instant); `formatChange(delta, currency, locale)` → `{ text,
sign: "pos" | "neg" | "zero" }`.
4. `lib/format/index.ts` re-exports; `lib/format/README.md` (six lines: why
   no float, what each does).

**Tests.** `lib/format/*.test.ts`: `pt-BR` and `en-GB` for money
(`R$ 1.234.567,89` / `R$1,234,567.89` — assert against
`Intl.NumberFormat(locale, { style: "currency", currency })
.format(1234567.89)` normalised for spaces, so the expectation is Intl's,
not a guess), a 30-digit integer printed exactly (the property: for
random canonical decimals with ≤ 15 significant digits, output equals
Intl's output normalised; beyond that, the digits are preserved
verbatim), negative zero never appears, percent sign rules, dates in both
locales.

**Done when.** `grep -rn "Number(" lib/format` is empty; tests green.

**Gate & QA.** Gate. `/qa-code-quality lib/format`.

**Commit.** `Milestone 4 Phase 2: lib/format — every figure from a decimal string`

---

### P2-U3 — Shell: nav, toggles, privacy mode, loading and error

**Goal.** SPEC §9.2's shell on the tokens, at desktop and 400 px, with the
theme and privacy toggles, `<Amount>`, `<ValueStatus>`, skip link,
`loading.tsx`, `error.tsx`.

**Read first.** `app/(app)/layout.tsx`; `app/(app)/_components/*`;
`SPEC.md` §9.2, §12.3 privacy, §11; the plan's "The design system";
Next docs on `loading.tsx`, `error.tsx` (client component), `useActionState`.

**Steps.**

1. `app/(app)/_components/nav.tsx` (+ `.module.css`): two groups (Analysis:
   `/`, `/performance`, `/allocation`, `/contribution`, `/maturities`;
   Ledger: `/assets`, `/transactions`, `/cash-flows`), Settings, theme
   toggle, privacy toggle, sign out; hairline beneath; under 640 px a
   `<details>`-based disclosure menu (no JS) with the current route
   marked `aria-current="page"`. Labels from `copy.nav`.
2. Theme toggle: a `<form action={setThemeAction}>` with three buttons
   (system / light / dark) or a cycling button; `setThemeAction` in
   `app/(app)/_actions/preferences.ts` writes `user_settings.theme` and the
   cookie, `revalidatePath("/", "layout")`.
3. Privacy: `app/(app)/_components/privacy-toggle.tsx` (`"use client"`):
   flips `data-privacy` on `<html>` and `localStorage["ff-privacy"]`;
   `aria-pressed`. `app/(app)/_components/amount.tsx`: a SERVER component
   `<Amount value={string} kind="money" | "quantity">` rendering
   `<span class="amount" aria-label={copy.privacy.hidden when on}>` — the
   mask is CSS: `[data-privacy="on"] .amount { color: transparent;
position: relative } [data-privacy="on"] .amount::after { content:
"•••"; color: var(--text); position: absolute; inset: 0 }`. Percentages,
   returns and names never use `<Amount>`.
4. `app/(app)/_components/value-status.tsx`: `<ValueStatus status=
"ok" | "carried_forward" | "stale" | "unpriced" date? reason?>` rendering
   the mark and the §11/§9.5 copy (`copy.status.*`), with `title` and an
   `aria-label`.
5. `app/(app)/layout.tsx`: skip link → `#main`; `<header>` with the nav;
   `<main id="main">`; the strip slot (P2-U4). `app/(app)/loading.tsx`
   (a token-coloured skeleton, no copy) and `app/(app)/error.tsx` (`"use
client"`; an error boundary receives no server props, so it reads the
   language from `document.documentElement.lang` and picks `copyFor`; the
   message names no error detail and offers "Try again" via `reset()`).
6. Restyle the existing unstyled pages only as far as the shell requires
   (they get their own units in Phase 5); nothing regresses.

**Tests.** `pnpm build`; manual at 1280 and 400 px in both themes; the
privacy toggle masks the amounts on `/assets` (the latest price column
uses `<Amount>` from now on); keyboard: skip link first, then nav in order.

**Done when.** Every route renders inside the shell; no horizontal scroll at
400 px; toggles persist across reloads.

**Gate & QA.** Gate + build. `/qa-spec-fidelity app/(app)/layout.tsx
app/(app)/_components against SPEC §9.2, §12.3 and US-013 AC-013.3–6` ·
`/qa-ux app/(app)/_components against specs/PERSONAS.md scenario "show the
screen to a partner"`.

**Commit.** `Milestone 4 Phase 2: the shell — nav, theme and privacy toggles, status marks`

---

### P2-U4 — Status strip and Refresh

**Goal.** SPEC §9.2's status strip: present only when something is pending,
each item linking to its screen, Refresh its only control, `aria-live`.

**Read first.** `SPEC.md` §9.2 "Status strip", §9.4 Refresh, §12.3 "Backup
reminder"; `app/(app)/assets/actions.ts` `refreshAction`; `lib/ledger/
queries.ts` `listAssets` (how unpriced is derived); the `snapshot_markers`
view; `lib/packs/activate.ts`; `packs/types.ts` `PriceSource.envVars`.

**Steps.**

1. `lib/ledger/status.ts`: `readStatus(client: Db, registry, env:
Readonly<Record<string, string | undefined>>, today: IsoDate): Promise<
LedgerStatus>` with `LedgerStatus = { unpricedAssets: number; rebuild:
{ from: IsoDate; through: IsoDate | null; target: IsoDate } | null;
disabledSources: { sourceId: string; variable: string }[]; exportNudge:
{ lastExportAt: string | null } | null }`. Unpriced: assets whose kind
   is `market_price`/`nav_unit_price` (registry) with no row in
   `asset_latest_prices` (ids read chunked). Rebuild: from
   `snapshot_markers` (the user's own row): when `earliest_trade_date` is
   set and `last_snapshot_date` is null or before the last trading day ≤
   today over the user's holdable calendars (`tradingCalendars` +
   `isTradingDay` from `lib/jobs/snapshots.ts`) — `{ from: earliest,
through: last, target: lastTradingDay }`. Disabled sources: for every
   source of the user's resolved packs, each declared `envVars` entry
   absent in `env` (names only). Export nudge: `transactions` count > 0 and
   (`last_export_at` null or older than 30 days).
2. Dismissal: cookie `ff-nudge-dismissed=<last_export_at ?? "none">` set by
   `dismissNudgeAction`; the strip hides the nudge while the cookie value
   equals the current state (a new export changes the value, so the nudge
   returns only when it is due again — "dismissable per occurrence, never
   permanently").
3. `app/(app)/_components/status-strip.tsx` (server): renders nothing when
   every field is empty/null; otherwise one line, items from `copy.status`
   (with counts), each a link (`/assets`, `/`, `/settings`), the Refresh
   form (`refreshAction` moved to `app/(app)/_actions/refresh.ts`; the old
   export in `assets/actions.ts` removed), `role="status" aria-live=
"polite"`. Mounted in `(app)/layout.tsx` under the nav.

**Tests.** `lib/ledger/status.test.ts` with the fake client: each item's
presence/absence; the export nudge's 30-day boundary; the source check by
name. `status.dbtest.ts`: the unpriced count against real rows.

**Done when.** A fresh instance shows no strip; add an asset without a token
→ "1 asset unpriced" and "source br.brapi disabled: BRAPI_TOKEN not set"
appear with links; Refresh works from the strip; `/assets` no longer has
its own Refresh.

**Gate & QA.** Gate + build. `/qa-spec-fidelity lib/ledger/status.ts
app/(app)/_components/status-strip.tsx against SPEC §9.2, §9.4, §12.3
backup reminder and US-009 AC-009.1` · `/qa-code-quality lib/ledger/status.ts`.

**Commit.** `Milestone 4 Phase 2: the status strip, with Refresh`

---

### P2-U5 — Overview and the first-run card

**Goal.** SPEC §9 screen 1 and §9.3, on snapshots plus one latest-price
valuation, with every §9.5 empty state.

**Read first.** `SPEC.md` §9 screen 1, §9.3, §9.5 rows 1–2; `lib/calc/
portfolio.ts` (`valuePortfolio`, `HoldingRow`); `lib/ledger/rows.ts`
(`"latest"` mode from P1-U5); `lib/ledger/queries.ts` `countLedger`; the
`snapshot_totals` view; `packs/br/fixtures/expected.json` (`valuations`
for the model tests); Recharts docs for `AreaChart`/`PieChart` (via the
installed package's types, not memory).

**Steps.**

1. `lib/ledger/snapshots.ts` (first half; P3-U1 extends): `readSnapshotTotals(
client, { from?, to? })` → `{ date, totalBase: string, rows, staleRows,
carriedRows }[]` from `snapshot_totals`, paginated by date;
   `readSnapshotRange(client)` → `{ first, last, count }`;
   `readSnapshotRowsAt(client, date)` text-cast rows (`quantity::text` etc.
   — write `SNAPSHOT_SELECT`).
2. `app/(app)/_models/overview.ts` — pure: `overviewModel(input: { counts,
settings, today, valuation: PortfolioValuation | null, unpricedAssets,
totals: SnapshotTotal[], latestRows, previousRows, assets, registry })`
   → `{ firstRun: { steps: [...4 with done flags] } | null, headline:
{ total: string; currency } | { unpriced: number }, dayChange:
{ delta, rate } | null, periodChange, sparkline: { date, y: string }[],
allocation: { kindLabel, share: string }[], movers: { assetId, name,
delta, rate }[], empties: … }`. All strings; ratios via `KernelDecimal`.
   First-run steps per the §9.3 table: base currency (`updated_at >
created_at` — add both columns to `SETTINGS_SELECT` — or any
   transaction), first asset, first transaction, priced (every market/nav
   asset has a latest price).
3. `app/(app)/page.tsx`: `requireUser`, reads in parallel (`countLedger`,
   `readSettings`, `readLedger(client, PACKS, { prices: "latest" })` →
   `valuePortfolio(toPortfolioInput(read), today)`, `readSnapshotTotals`
   for the last 90 days + the two latest row sets), builds the model,
   renders: the card (`copy.firstRun`), the headline in Instrument Serif
   through `<Amount>`, changes with sign and arrow and `--pos/--neg`,
   `<Sparkline>` and `<Donut>` from `app/(app)/_charts/` (client, Recharts,
   thin strokes, `toCoordinate` for y, formatted strings for labels and
   tooltips), top movers table with `<ValueStatus>`, and the §9.5 empties.
4. `app/(app)/_charts/sparkline.tsx`, `donut.tsx`: `"use client"`, props are
   `{ points: { x: string; y: number; label: string }[] }` — the label is
   the formatted string, the tooltip prints the label, never the number.
   `prefers-reduced-motion` → `isAnimationActive={false}`.

**Tests.** `overview.test.ts`: over the golden ledger seeded into the fake
client and `expected.json`'s valuations as totals — the headline equals the
`asOf` total, day change equals the last two totals' difference, the card
disappears when counts are nonzero and prices exist, each empty state
triggers on its condition; percentages of the donut sum to 100.00.

**Done when.** `/` on a fresh instance shows the four-step card and "—";
with the golden ledger restored and snapshots run, the headline, changes,
sparkline and donut render in both themes at 400 px.

**Gate & QA.** Gate + build. `/qa-spec-fidelity app/(app)/page.tsx
app/(app)/_models/overview.ts against US-009 and SPEC §9.3, §9.5` ·
`/qa-code-quality app/(app)/_models app/(app)/_charts lib/ledger/snapshots.ts`
· `/qa-ux / against specs/PERSONAS.md "evening check"`.

**Commit.** `Milestone 4 Phase 2: Overview — first-run card, headline, changes, sparkline, donut`

---

### P2-U6 — Review gate (M-2)

**Goal.** The maintainer sees the direction before nine more screens follow
it.

**Steps.**

1. `e2e/gate.spec.ts` (kept; reused by P7-U1's helpers): sign in as a
   throwaway owner with the golden ledger restored and snapshots run
   (helpers in `e2e/helpers.ts`: `createOwner`, `restoreGolden`,
   `runSnapshots` via `GET /api/cron/snapshots` with the CRON_SECRET), then
   screenshot `/login` and `/` in light and dark, desktop and phone, into
   `docs/review/phase-2/` (gitignored).
2. Post: the eight paths, three sentences on what was chosen (type scale,
   palette, density) and the one question worth asking (if any). Apply
   §0.4 M-2.

**Done when.** Screenshots exist; the gate is answered or passed by default,
recorded in the index.

**Commit.** `Milestone 4 Phase 2: review gate screenshots — Phase 2 complete`
(the spec and helpers only). Set Phase 2 `done` in the plan.

---

### P3-U1 — Snapshot readers and `seriesReturn`

**Grounded 2026-09-21** against the tree after Phase 2. What Phase 2 already
built: `lib/ledger/snapshots.ts` (`readSnapshotTotals`, `readSnapshotRange`,
`readSnapshotRowsAt`, `readSnapshotRowsBetween`), `app/(app)/_models/`
with the golden-ledger test pattern (`goldenLedgerRead` + `expected.json`),
`app/(app)/_charts/` (`toCoordinate`, `useReducedMotion`, the tooltip
class), `lib/format`, `<Amount>`, `<ValueStatus>`, `copy.screens.*`. No
per-asset series reader is added until a screen consumes it (drift rule).

**Goal.** The one kernel addition of the milestone, and the shared period
logic every analysis screen uses.

**Read first.** `lib/calc/series/{index-level,rate,inflation,fx-rate}.ts`
(`indexReturn(market, id, from, to, windowDays)`, `compoundRate(market, id,
kind, calendar, from, to)` → `{ factor }`, `inflationLevelAt(market, id,
date, interpolation)`, `fxRateAt`); `lib/calc/staleness.ts` (`Observed<T>`,
`UnpricedReason`, `worseOf`, `hasValue`); `lib/calc/twr.ts` (`SubPeriod`
carries `return`); `lib/calc/portfolio.ts` (`stalenessWindowFor`, `toBase`);
`lib/calc/README.md`; `packs/br/series.ts` (roles).

**Steps.**

1. `lib/calc/benchmark.ts` — `seriesReturn(descriptor: SeriesDescriptor,
market: MarketData, from: IsoDate, to: IsoDate, ctx: { calendar:
MarketCalendar; windowDays: number }): Observed<KDecimal>`:
   `index_level` → `indexReturn(market, id, from, to, windowDays)`;
   `rate_daily` / `rate_annual` → `compoundRate(market, id, kind, calendar,
from, to)` → `factor − 1` as `{ status: "ok", value, observedOn: to }`, a
   `series_gap` passes through as `unpriced`; `inflation_index` → level
   ratio − 1 through `inflationLevelAt` at both ends (worse status wins,
   like `indexReturn`); `fx_rate` → `fxRateAt` ratio − 1; `yield_curve` →
   `unpriced` with the new closed reason `not_a_return_series` (added to
   `UnpricedReason` in `staleness.ts` and the README's reason list — a
   curve has no single return; not a contract violation). `from > to` is a
   `KernelError("invalid_input")`. Export from `lib/calc/index.ts`; README
   entry under Performance.
2. `app/(app)/_models/period.ts` — pure: `PERIOD_KEYS = ["1m", "ytd", "1y",
"all"]`, `resolvePeriod(key, today, range: SnapshotRange, totals:
SnapshotTotal[]): { key; from; to } | null` — `to` = the last snapshot
   date; `from` = the latest snapshot date ≤ the period's start
   (`addMonths(to, −1)`, `${year}-01-01`, `addMonths(to, −12)`, the first
   date), so the first sub-period has a start value; `defaultPeriod(range)`
   = `"all"` when the span is under a year, else `"1y"` (AC-010.1); null
   below two snapshots.
3. `app/(app)/_models/shares.ts` — `sharesSummingTo100(values: string[]):
string[]` — integer basis points by largest remainder so two-decimal
   shares sum to exactly `"100.00"` (AC-011.1); returns unit shares as
   decimal strings (`"0.4567"`). Overview's donut switches to it.
4. `app/(app)/_models/flows.ts` — `baseFlowsOf(read: LedgerRead, input:
PortfolioInput): { flows: BaseFlow[]; dropped: number }` — a flow in the
   base currency maps directly; another currency (reachable only from a
   restored file, decision 25 forbids it at entry) is converted with
   `toBase(input, money, date, packId)` under the first holdable pack's
   window; `unpriced` → dropped and counted (decision 54).

**Tests.** `benchmark.test.ts`: hand cases per kind; the two decision-37
properties (`index_level` equals `indexReturn`; a constant `rate_daily` r
over n business days equals `(1 + r)^n − 1` within `1e-30`); stale
propagation; `yield_curve` → `not_a_return_series`. `period.test.ts`: each
key over the golden dates, the default rule, null below two snapshots.
`shares.test.ts`: a property that the two-decimal shares of any positive
vector sum to exactly 100.00 and each is within 0.01 of the exact share.
`flows.test.ts`: base flows pass through; a foreign flow converts or drops.

**Done when.** `pnpm test:calc` includes the new properties; `pnpm
test:packs` still 1 skip.

**Gate & QA.** Gate + `test:packs`. `/qa-code-quality lib/calc/benchmark.ts
app/(app)/_models/{period,shares,flows}.ts` · `/qa-spec-fidelity against
MILESTONES §4 decisions 37, 53, 54 and lib/calc/README.md rules`.

**Commit.** `Milestone 4 Phase 3: seriesReturn, periods, shares, base flows`

---

### P3-U2 — Performance

**Goal.** SPEC §9 screen 2 exactly: period selector, TWR, MWR, the chart
with registry-driven benchmark toggles, nominal/real.

**Read first.** `SPEC.md` §9 screen 2, §6, §9.5 row 3; `lib/calc/twr.ts`
(`twr(points, flows)` → `{ twr, subPeriods[{from,to,return}], skipped,
ignored }`), `lib/calc/mwr.ts` (`mwr({ from, to, startValue, flows,
endValue })` → `{ status, rate | reason, ignored }`), `lib/calc/real.ts`
(`realReturn(nominal, market, deflator, from, to)`); `MILESTONES.md` §2
decisions 1, 2, 10, 16; `lib/calc/golden.ts` `runGolden` (the reference
wiring); `app/(app)/page.tsx` (the read pattern).

**Steps.**

1. `app/(app)/_models/performance.ts` — pure `performanceModel(input)`:
   - input: `{ period; totals: SnapshotTotal[] (in [from, to]); flows:
BaseFlow[]; droppedFlows: number; benchmarks: Array<{ descriptor;
points: Array<{ date; value: Observed<KDecimal> }> }>; real:
Observed<KDecimal>[] | null (the cumulative points deflated) }`.
   - **Decision 53:** the valuation points handed to `twr()` are the
     totals whose `staleRows === 0`; a stale date is not a point — it is
     listed in `staleDates` and drawn as a gap with the mark.
   - `twr`: `{ rate: string | null; skipped: count; ignored: count }`;
     `mwr`: `{ rate: string | null; reason? }`; `series`: one row per
     point `{ date, portfolio: cumulative string (Π(1 + r) − 1 over
`subPeriods` up to that date), [benchmarkId]: string | null }`;
     `partial` when flows were dropped or sub-periods skipped.
2. `app/(app)/performance/page.tsx` — `searchParams`: `period`
   (`PERIOD_KEYS`, else the default), `benchmarks` (comma-separated series
   ids; default the first `benchmark`-role series of the user's holdable
   packs), `real=1`. Reads: `readSnapshotRange`, then `readSnapshotTotals`
   in the resolved window, `readLedger(client, PACKS, { seriesFrom:
addDays(from, −SERIES_LOOKBACK_DAYS), prices: "latest" })` — the series
   are what `seriesReturn` and `realReturn` need; prices are not (the
   portfolio line comes from the totals). Per benchmark descriptor (from
   `read.packs`, role `benchmark`, id in the selection), per point date
   `d`: `seriesReturn(descriptor, market, from, d, { calendar: the
descriptor's pack calendar, windowDays: stalenessWindowFor(input,
packId, d) })`. The `deflator` role (first in the packs) drives the
   real toggle; hidden when none. Toggles are `<Link>`s that rewrite the
   query — no client state.
3. `app/(app)/_charts/performance-chart.tsx` (`"use client"`): Recharts
   `LineChart`, x = formatted date, y = coordinate; the portfolio line in
   `--accent` at 1.5 px, benchmarks in `--text-muted` at 1 px, direct
   labels at the line ends (the last point's formatted value), a hidden
   `YAxis` with `domain={["dataMin", "dataMax"]}`, `XAxis` with 4–6 ticks,
   the tooltip printing the row's formatted strings (all points formatted
   server-side and passed in), stale dates as `connectNulls={false}` gaps
   marked with `⚠` in the tooltip; `isAnimationActive={!reduced}`.
4. Copy: `copy.screens.performance` (title, period labels, twr, mwr,
   benchmarks, nominal, real, skipped/dropped notes) in both languages.
5. §9.5 empties verbatim; MWR null → `copy.reasons`-style line for
   `insufficient_flows` / `no_root` (added under `copy.screens.performance`).

**Tests.** `performance.test.ts` over the golden: with the six golden
totals as points and the fixture's flows, the model's TWR equals
`expected.json`'s `twr` to `1e-8` and the MWR its `mwr`; the cumulative
series' last point equals the TWR; a stale date is excluded from the
chain and listed; a benchmark's points are pass-through; the real
transform applies. `benchmark` selection and defaults are unit-tested on
a small pure helper (`benchmarkSelection(packs, param)`).

**Done when.** `/performance` on the golden ledger with snapshots shows the
golden TWR and MWR; toggles rewrite the query; empties verbatim at 0 and 1
snapshots.

**Gate & QA.** Gate + build. `/qa-spec-fidelity app/(app)/performance
app/(app)/_models/performance.ts against US-010` · `/qa-code-quality` same
· `/qa-ux /performance`.

**Commit.** `Milestone 4 Phase 3: Performance — TWR, MWR, benchmarks, real`

---

### P3-U3 — Allocation

**Goal.** SPEC §9 screen 3 from the latest snapshot rows.

**Read first.** `SPEC.md` §9 screen 3, §9.5 row 4; `readSnapshotRowsAt`;
`resolveAssets`; `sharesSummingTo100`.

**Steps.**

1. `app/(app)/_models/allocation.ts` — pure over `{ rows: SnapshotAssetRow[]
(at the last date); assets: HoldingAsset[]; names }`: `byKind`, `byPack`,
   `byCurrency` each `Array<{ key, label, valueBase, share }>` (shares via
   `sharesSummingTo100`, largest first); `exposure: Array<{ currency,
native: string (Σ quantity × priceNative), base: string (Σ
marketValueBase) }>`; `stale: Array<{ assetId, identifier, lastKnownBase,
priceDate }>` listed aside and excluded from shares; `empty` when no
   confident row.
2. `app/(app)/allocation/page.tsx`: three `<Donut>`s (one component, reused)
   with their legends, the exposure table (`<Amount>` on every value),
   the stale list with `<ValueStatus status="stale">`, the empty state →
   `/assets`. Copy `copy.screens.allocation`.

**Tests.** `allocation.test.ts` over the golden `asOf` rows (from
`valuePortfolio` as in `overview.test.ts`): shares sum to exactly 100.00 in
each view; the seven kinds appear; a stale row is excluded from shares and
listed; BRL-only exposure has native = base.

**Done when.** `/allocation` renders over the golden; empty state verbatim.

**Gate & QA.** Gate + build. `/qa-spec-fidelity against US-011 AC-011.1,
AC-011.4` · `/qa-code-quality` · `/qa-ux /allocation`.

**Commit.** `Milestone 4 Phase 3: Allocation — Phase 3 complete`

---

### P4-U1 — Contribution and attribution drill-in

**Goal.** SPEC §9 screen 4 with the per-asset drill-in.

**Read first.** `SPEC.md` §9 screen 4, §6, §11 BDR gap, §9.5 row 5;
`lib/calc/contribution.ts` (`contribution({ input, from, to, start, end,
flows })` → `{ assets[{ assetId, contribution | null, reason? }], total,
partial, denominator }`), `lib/calc/attribution.ts` (`attribution(input,
assetId, from, to)` → `{ boundaries, rNative, rBase, rFx, reason? }`);
`MILESTONES.md` §2 decision 15; `lib/calc/golden.ts` lines 228–262.

**Steps.**

1. `app/(app)/_models/contribution.ts` — pure: `contributionModel({ result:
ContributionResult; names; identifiers; droppedFlows })` → rows
   `{ assetId, identifier, name, gain: string | null, share: string | null
(contribution / denominator... no: the kernel's `contribution`IS the
share of the simple return — carry it as`contribution: string | null`),
reason? }` sorted by |contribution| desc, `total: string | null`,
   `partial`, `reasons: count per reason`; `attributionModel(a: Attribution,
baseCurrency)` → `{ rNative, rBase, rFx (all string | null), reason?,
isBaseCurrency (rFx === "0") }`.
2. `app/(app)/contribution/page.tsx`: the period selector (P3-U1's
   `resolvePeriod` and the same links), `readLedger(client, PACKS, {
pricesFrom: addDays(from, −SERIES_LOOKBACK_DAYS), seriesFrom: the same })`
   → `input = toPortfolioInput(read)`, `start = valuePortfolio(input, from)`,
   `end = valuePortfolio(input, to)`, `flows = baseFlowsOf(read, input)`,
   `contribution({ input, from, to, start, end, flows })`; horizontal bars
   (`app/(app)/_charts/bars.tsx`: `BarChart` layout vertical, `--pos` /
   `--neg` cells, the formatted value as the label), the partial banner
   listing reasons through `copy.status.unpricedReason`, each row linking
   to `/contribution/[assetId]?period=`.
3. `app/(app)/contribution/[assetId]/page.tsx`: the same read; `attribution(
input, assetId, from, to)`; a three-line table R_native / R_fx / R_base
   with `formatPercent`, the identity line `(1 + R_base) = (1 + R_native) ×
(1 + R_fx)` stated in copy, "quoted in your base currency, so R_fx = 0"
   when `rFx` is exactly zero, the §11 gap sentence once (no currency
   named), `no_position` and null legs through `<ValueStatus>`-style copy.
4. Copy `copy.screens.contribution` both languages; §9.5 empty verbatim.

**Tests.** `contribution.test.ts` over the golden between its first and
last valuation dates: every asset's contribution equals `expected.json`'s
`contribution.assets[id]` to `1e-8` and the total its `total`; sorted by
magnitude; a fake missing-FX case yields `no_fx_series` and `partial`.
`attributionModel` over each golden asset has `rFx === "0"` and
`isBaseCurrency`.

**Done when.** Both routes render on the golden; empties verbatim.

**Gate & QA.** Gate + build. `/qa-spec-fidelity against US-011 AC-011.2–3`
· `/qa-code-quality` · `/qa-ux /contribution`.

**Commit.** `Milestone 4 Phase 4: Contribution and the FX attribution drill-in`

---

### P4-U2 — Maturities

**Goal.** SPEC §9 screen 5 by the decision 38 convention.

**Read first.** `SPEC.md` §9 screen 5, §9.5 row 6; `PACKS.md` §5 (the
maturity sentence); `lib/calc/valuation/index.ts` (`valueHolding(asset,
lots, asOf, ctx: { market, calendar, windowDays, series })` → `HoldingValue`),
`lib/calc/positions.ts` (`lotsAt(transactions, date)` — per asset: filter
the ledger's transactions by `assetId` first); `packs/br/instruments.ts`
(`maturity` on `PrivateCreditMetadata` and `TesouroDiretoMetadata`; plain
= `convention.index === undefined`).

**Steps.**

1. `lib/ledger/maturity.ts` — `hasMaturity(kind: InstrumentKind): boolean`
   (zod v4: `kind.metadataSchema instanceof z.ZodObject && "maturity" in
kind.metadataSchema.shape`); `maturityOf(asset: HoldingAsset): IsoDate |
null` (`z.object({ maturity: IsoDateSchema }).loose().safeParse(
asset.metadata)`); `isPlainRateAccrual(kind)`. No kind id anywhere.
2. `app/(app)/_models/maturities.ts` — pure over `{ read: LedgerRead; today;
valuation: PortfolioValuation (today, latest-mode read) }`: for each
   asset with open lots at `today` and a maturity: `{ assetId, identifier,
name, kindLabel, maturity, daysToGo: number (calendar), matured:
maturity < today, current: the asset's `HoldingRow`| excluded entry,
contracted: string | null — plain-rate accrual only:`valueHolding(asset,
   lotsAt(txnsOf(asset), today), maturity, ctx)`with`ctx = { market,
   calendar: pack calendar, windowDays: stalenessWindowFor(input, packId,
   maturity), series }`→`native.amount`when`ok`/`carried_forward`,
indexed: `convention.index !== undefined` }` sorted by maturity;
   `timeline: Array<{ month: IsoDate (first of month); items }>`; `empty`
   when none.
3. `app/(app)/maturities/page.tsx`: the ladder table (date, days to go,
   current with `<ValueStatus>`, contracted or the "depends on the index"
   line, matured mark with the AC-012.2 copy and a link to add the sell)
   and the timeline grouped by `formatMonth`; `<Amount>` on every value;
   empty → `/assets`. Copy `copy.screens.maturities`.

**Tests.** `maturity.test.ts`: `hasMaturity` true for the four BR
fixed-income kinds and TD, false for FII and stock, by shape alone;
`maturityOf` on the golden metadata. `maturities.test.ts` over the golden
at `asOf`: five assets in date order (TD + four credits); the prefixado's
contracted value equals `valueAccrual` at its maturity date; the % CDI and
IPCA+ kinds show no projection; TD shows none (NAV); with `today` past a
maturity the row is `matured`.

**Done when.** `/maturities` lists the golden's fixed income in date order.

**Gate & QA.** Gate + build. `/qa-spec-fidelity against US-012 and
MILESTONES §4 decision 38` · `/qa-code-quality lib/ledger/maturity.ts` ·
`/qa-ux /maturities`.

**Commit.** `Milestone 4 Phase 4: Maturities — Phase 4 complete`

---

### P5-U1 — Schema-driven fields and the asset form

**Goal.** The asset form is pack → kind → generated metadata fields →
currency; the JSON textarea is gone; no screen knows a kind by name.

**Read first.** `app/(app)/assets/_form.tsx`, `actions.ts`; `lib/ledger/
assets.ts` (metadata validation); `packs/schema.ts` (`DecimalStringSchema`,
`IsoDateSchema`); zod v4 introspection (`schema.shape`, `def.type`,
`unwrap()`); every in-repo `metadataSchema`.

**Steps.**

1. `lib/forms/zod-fields.ts`: `fieldsOf(schema: ZodType): Field[]` for a
   `ZodObject`: each key → `{ name, label (from the key, humanised),
kind: "text" | "decimal" | "date" | "select" | "checkbox", required,
options? }` — `decimal` when the unwrapped schema `=== DecimalStringSchema`,
   `date` when `=== IsoDateSchema`, `select` for `z.enum`, `checkbox` for
   `z.boolean`, `text` for `z.string`; a `z.number()` throws
   `unsupported_metadata_field` (values are strings). `valuesFromForm(
fields, formData)` builds the metadata object (empty optional → omitted).
2. `_form.tsx`: pack `<select>` (registry, status shown), kind `<select>`
   (per pack; a native form: changing the pack submits `?pack=` — or a small
   client component that swaps the kind list; choose the client component,
   it is interaction only), the generated fields (`<input inputmode=
"decimal">` for decimals, `type="date"` for dates), identifier with the
   kind's `IdentifierSpec` hint, currency defaulting to the kind's
   `quoteCurrency`. Edit form: identity fields read-only once traded
   (decision 27), name and metadata editable. `useActionState` for pending
   and field errors (decision 48).
3. `actions.ts`: build `metadata` through `valuesFromForm`; validation stays
   in `lib/ledger/assets.ts`.
4. The import preview's inline asset creation reuses the same form
   component with pack and kind fixed from the CSV.

**Tests.** `zod-fields.test.ts`: every in-repo `metadataSchema` yields one
field per key with the right kinds; round trip `valuesFromForm(fields,
form(values))` deep-equals for each golden asset's metadata; a number field
throws.

**Done when.** No `metadata` textarea anywhere; creating each of the seven
BR kinds through the form succeeds locally.

**Gate & QA.** Gate + build. `/qa-spec-fidelity against US-013 AC-013.7,
SPEC §9 screen 6, MILESTONES §4 decision 45` · `/qa-code-quality lib/forms
app/(app)/assets`.

**Commit.** `Milestone 4 Phase 5: the registry-driven asset form`

---

### P5-U2 — Assets, Transactions and Import designed

**Goal.** Screens 6 and 7 on the tokens with their states, empties and
phone layouts; the import as four steps.

**Read first.** the three page files and their actions; `SPEC.md` §9 screens
6–7, §9.1, §9.4, §9.5 rows 7–8; `lib/ledger/queries.ts`.

**Steps.**

1. Assets list: row states priced (value, source, date) / carried forward /
   stale / unpriced with reason (`sourceError`, "Retry · Enter a price")
   / accrues (accrual kinds: "accrues — valued from the series");
   `<Amount>`, `<ValueStatus>`; manual price form on the asset page;
   pager restyled; empty state verbatim with the two links.
2. Transactions list: date, asset, type, quantity, price, fees, note;
   filters none (scope); add/edit form on the tokens with `useActionState`;
   `fx_rate` labelled "optional, display only" (D-28); empty state verbatim.
3. Import: steps Upload → Map columns → Preview (per-row status: ok /
   error fields / unresolved with inline create / duplicate with
   force-include) → Commit, each a section with a step indicator; the
   counts line; the canonical format documented in-app (`copy.import.format`).
4. All strings through `copy` in both languages; phone layouts (tables
   stack into definition lists under 640 px).

**Tests.** Existing action and import tests unchanged and green; `pnpm
build`; manual run of the golden CSV through the four steps.

**Done when.** Both screens and the import pass the P7 checklist visually at
400 px; nothing that worked in Milestone 3 regressed (the dbtests say so).

**Gate & QA.** Gate + build. `/qa-spec-fidelity against SPEC §9 screens 6–7,
§9.1, §9.4, §9.5 and US-013` · `/qa-code-quality app/(app)/assets
app/(app)/transactions` · `/qa-ux /assets /transactions /transactions/import
against "import a broker CSV"`.

**Commit.** `Milestone 4 Phase 5: Assets, Transactions and Import designed`

---

### P5-U3 — Cash flows, Settings, Login/MFA/reset designed

**Goal.** Screens 8, 9, 10 on the tokens; every remaining string in both
dictionaries.

**Read first.** the pages and actions; `SPEC.md` §9 screens 8–10, §9.6,
§12.3, §9.5 rows 9–10; `app/(app)/settings/totp-enrol.tsx`.

**Steps.**

1. Cash flows: list + form; the empty state's sentence verbatim; base
   currency shown, not editable (decision 25).
2. Settings in the §9 screen 9 sections: Portfolio (base currency with the
   lock/reset explanation, enabled packs with status badges and the draft
   banner, theme, locale — the locale select lists `LOCALES` with their own
   names); Security (change password, TOTP enrol/remove with the QR, sign
   out everywhere, the AAL2 notes); Your data (export — two buttons —, the
   last export date, restore with warnings, delete everything with the
   phrase and password); the SPEC §12.1 disclosure paragraph.
3. Login, `/login/mfa`, `/login/reset`: the tokens, the one bootstrap line,
   uniform failure copy, no signup link (assert in the e2e later).
4. `grep -rn '"[A-Z][a-z].*"' app --include=*.tsx` (or equivalent) finds no
   user-facing literal outside `lib/copy`; anything left moves.

**Tests.** Existing `settings.test.ts`, `security.test.ts`, dbtests green;
`copy.test.ts` still complete; build.

**Done when.** Every screen SPEC §9 names exists and is designed; the
copy grep is clean.

**Gate & QA.** Gate + build. `/qa-spec-fidelity against SPEC §9 screens 8–10,
§9.6, §12.3 and US-013 AC-013.7–8` · `/qa-code-quality app/(app)/settings
app/(app)/cash-flows app/login` · `/qa-ux /settings /login`.

**Commit.** `Milestone 4 Phase 5: Cash flows, Settings and Login designed — Phase 5 complete`

---

### P6-U1 — Synthetic ledger and performance budgets

**Goal.** Decision 44 measured; D-23 measured; fixes only where a budget
fails.

**Read first.** `lib/testing/golden.ts` (how the golden is seeded);
`lib/calc/golden.ts` (`GoldenFixtureSchema`); `lib/jobs/snapshots.dbtest.ts`;
every `_models/*.ts` and page read path; `lib/csv/parse.ts`.

**Steps.**

1. `lib/testing/synthetic.ts`: `syntheticLedger(seed: number): GoldenFixture`
   — deterministic PRNG (mulberry32), five years ending today, twenty
   assets across all seven BR kinds, a monthly buy each, quarterly sells on
   three, FII dividends, daily prices for market/nav kinds with random 3 %
   gaps, CDI/SELIC daily and IPCA monthly series, a deposit per buy. All
   values decimal strings built with `KernelDecimal`. Seeded through the
   same helper as the golden.
2. `lib/jobs/performance.dbtest.ts`: seed for a throwaway user; time
   `runSnapshots` with a generous budget → days/s; time `readLedger` (both
   modes), `readSnapshotTotals` over five years, each model over its reads
   (5 runs, p50) and `parseCsv` over a 20k-row file written by `writeCsv`.
   Print a table; assert the thresholds (`≥ 50 days/s`, `< 500 ms` p50,
   parse `< 500 ms`).
3. `docs/performance-budgets.md`: the table with the machine, date and
   numbers, the thresholds, and how to re-run.
4. Where a threshold fails: fix in the smallest place — a date-ranged
   read, a narrower select, a read view (allowed by decision 52). An index
   is a schema change outside decision 52: if only an index would meet a
   budget, record the measured number and the proposed index in the
   Blocked list as a decision for the maintainer, and continue. D-23:
   rewrite `parseCsv` with index scanning only if its number fails.

**Tests.** The dbtest itself (excluded from CI's `test:db` by an env flag
`FF_BUDGETS=1` so CI stays fast; documented).

**Done when.** The doc records numbers within thresholds.

**Gate & QA.** Gate. `/qa-code-quality lib/testing/synthetic.ts
lib/jobs/performance.dbtest.ts`.

**Commit.** `Milestone 4 Phase 6: synthetic five-year ledger and measured budgets — Phase 6 complete`

---

### P7-U1 — Smoke journeys

**Goal.** Decision 46's eight journeys plus decision 40's security-boundary
journey, against the local stack, in CI.

**Read first.** `e2e/*` (P0-U3, P2-U6); `lib/auth/auth.dbtest.ts` (the RFC
6238 generator — move it to `lib/testing/totp.ts`, import from both);
Playwright docs (installed package) on `globalSetup`, `storageState`,
`page.on("console")`.

**Steps.**

1. `e2e/setup.ts`: creates one throwaway owner through the admin API (email,
   password in `process.env` for the run), stores nothing on disk;
   teardown deletes the user. `e2e/helpers.ts`: `signIn(page)`, `enrolTotp`
   (reads the secret from the enrolment page, generates codes),
   `restoreGolden`, `runSnapshots`, `expectNoCspViolations(page)` (fails on
   any `console` message containing "Content Security Policy").
2. Nine files: `01-sign-in.spec.ts`, `02-enrol-totp.spec.ts` (then a fresh
   context must pass the challenge), `03-add-asset.spec.ts` (each of the
   seven kinds via the generated form; without a token the row says unpriced
   with `missing_env:BRAPI_TOKEN`), `04-import-csv.spec.ts` (the golden
   transactions written by `writeCsv` at test time; unresolved assets
   created inline; commit; re-import is a no-op), `05-analysis.spec.ts`
   (restore golden + snapshots; Overview, Performance, Maturities show the
   golden figures formatted), `06-export.spec.ts` (both downloads parse;
   `last_export_at` set), `07-privacy-mode.spec.ts` (toggle → every
   `.amount` reads `•••`; reload keeps it), `08-phone.spec.ts` (the `phone`
   project: every route, no horizontal overflow, menu opens),
   `09-boundary.spec.ts` (decision 40: signed out, every `(app)` route and
   the export route redirect to `/login`; with a factor enrolled and only a
   password, every route redirects to `/login/mfa`; every response carries
   the decision 51 headers).
3. `ci.yml`: job `e2e` after `db`'s pattern: stack up, env, `pnpm exec
playwright install --with-deps chromium`, `pnpm build`, `pnpm test:e2e`;
   upload `playwright-report` on failure.

**Tests.** The journeys; `pnpm test:e2e` green locally and in CI.

**Done when.** Nine green specs in both projects where applicable; zero CSP
violations logged.

**Gate & QA.** Gate + e2e. `/qa-spec-fidelity e2e against MILESTONES §4
decisions 40, 46 and US-014 AC-014.2, AC-014.4` · `/qa-code-quality e2e`.

**Commit.** `Milestone 4 Phase 7: nine smoke journeys, in CI`

---

### P7-U2 — Accessibility pass

**Goal.** US-013 AC-013.5 walked and written down.

**Read first.** `globals.css` tokens; every page; WCAG AA contrast (4.5:1
text, 3:1 large and UI).

**Steps.**

1. `docs/accessibility.md`: the checklist (landmarks, skip link, labels,
   focus order, contrast, reduced motion, 400 px, `aria-live`, error copy)
   and a table screen × item with the date walked.
2. `lib/testing/contrast.test.ts` (unit, no browser): parse the token
   values from `globals.css` and assert the pairs text/bg, muted/bg,
   pos/bg, neg/bg, accent/bg meet AA in both themes (relative luminance —
   a `number` on colours is fine; it is not a value). Adjust tokens until
   they pass; re-check screenshots.
3. Fix what the walk finds; every fix is on the tokens or a component,
   never one page.

**Tests.** The contrast test; e2e still green (a token change cannot break
a journey, but run them).

**Done when.** The table is full; the contrast test passes.

**Gate & QA.** Gate + e2e. `/qa-ux every route against specs/PERSONAS.md` ·
`/qa-code-quality lib/testing/contrast.test.ts`.

**Commit.** `Milestone 4 Phase 7: accessibility pass — Phase 7 complete`

---

### P8-U1 — Fixtures re-recorded; packs `supported` (M-3)

**Goal.** PACKS §12's criteria met and the manifests say so.

**Read first.** `PACKS.md` §12; `scripts/record-fixtures.ts`; both manifests;
`packs/*/README.md` status lines; `scripts/check-release-readiness.ts`.

**Steps.**

1. `pnpm fixtures:record --all` with the live token; inspect the diff for
   redaction and shape; `pnpm test:packs` green (1 skip); fix an adapter if
   an upstream contract moved (record it under "Contract corrections").
2. `packs/br/index.ts` and `packs/global/index.ts`: `status: "supported"`;
   READMEs' status lines; the Settings draft banner disappears.
3. Commit body: the evidence per criterion (maintainer, CI green run id,
   fixture dates).

**Done when.** `tsx scripts/check-release-readiness.ts` lists nothing but
what P8-U2 supplies (or passes).

**Gate & QA.** Gate + `test:packs`. `/qa-spec-fidelity packs against
PACKS §12 and MILESTONES §4 decision 41`.

**Commit.** `Milestone 4 Phase 8: fixtures refreshed; packs br and global supported`

---

### P8-U2 — Deploy runbook, `.env.example`, release gate green

**Goal.** Everything a deploy needs is written; `pnpm release:check` green.

**Read first.** `ARCHITECTURE.md` §8; `supabase/config.toml` `[auth]` block
(the settings the dashboard must mirror); `vercel.json`; `lib/cron/budget.ts`;
`.env.example`; `scripts/bootstrap-user.ts`; `README.md`.

**Steps.**

1. `docs/DEPLOY.md`: Supabase project (create; `supabase link`; `supabase db
push`; dashboard auth: signups off, password 12 chars, email provider
   on, confirmations off, TOTP on, site URL + redirect `<site>/auth/callback`,
   SMTP for reset mail); Vercel project (import the repo; env vars by name;
   `CRON_SECRET` via `openssl rand -base64 32`; the two crons from
   `vercel.json`; Fluid compute check — D-27: if enabled, raise both
   literals in `lib/cron/budget.ts` and the routes); first deploy; `pnpm
bootstrap:user` against production (env pointed at the project); first
   sign-in and TOTP; observe both crons fire once (Vercel logs show the
   D-19 summary lines); run `pnpm test:e2e` against production with
   `NEXT_PUBLIC_SITE_URL` set (the setup creates and deletes its own
   owner); rollback: redeploy the previous Vercel build; the database is
   forward-only. Every step names variables, never values.
2. `.env.example`: complete and commented (add `FF_BUDGETS`, nothing else
   new).
3. `README.md`: Status and Getting started updated; `ARCHITECTURE.md` §8
   "First-time local setup" and a "Deploying" pointer to `docs/DEPLOY.md`;
   `CLAUDE.md` current state.
4. `pnpm release:check` locally: green. CI: add a `release` job running it
   on `main` only (needs the stack and browsers — reuse the `e2e` job's
   steps).

**Done when.** `pnpm release:check` prints "Release readiness checks passed."
locally and in CI.

**Gate & QA.** Full `release:check`. `/qa-spec-fidelity docs/DEPLOY.md
against ARCHITECTURE §8, SPEC §9.6, MILESTONES §4 decision 43` ·
`/qa-code-quality .env.example docs/DEPLOY.md` (no values).

**Commit.** `Milestone 4 Phase 8: deploy runbook and a green release gate — Phase 8 complete`

---

### P9-U1 — First deploy with the maintainer (M-4)

**Goal.** The app is live on the maintainer's accounts; real data is
permitted.

**Steps.** Follow `docs/DEPLOY.md` with the maintainer at the keyboard for
every account step. After the journeys pass against production, record in
`MILESTONES.md` §4: date, "deployed" (URL redacted), both crons observed,
the e2e run, and mark the milestone complete with the commit range. Update
`CLAUDE.md` "Current state" and the plan's Progress table.

**Done when.** `MILESTONES.md` §4 carries the deploy record.

**Commit.** `Milestone 4 Phase 9: first deploy recorded — Milestone 4 complete`

## 3. Hand-off at the end of an unattended run

If the run stops at M-4, leave the maintainer this, in the final message
and at the top of the index's Blocked list:

- The commit range of the run and the CI run ids (green).
- The state of the four touchpoints (M-1 closed or unverified; M-2 answered
  or passed by default; M-3 flipped with evidence; M-4 pending).
- The Advisories recorded and the Contract corrections found.
- `docs/DEPLOY.md` is the next step; nothing in it needs a code change.
