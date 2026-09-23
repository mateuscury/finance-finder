# SPEC.md — Portfolio Dashboard

Full specification: schema, RLS, calculations, ingestion, screens, design system.
Read `ARCHITECTURE.md` first for the principles this spec obeys, and `PACKS.md`
for the extensibility contract the schema is shaped around.

> **Document precedence.** `PACKS.md` and the initial migration in
> `supabase/migrations/` own the schema **shape**; this document owns the
> **features** the schema must serve and every formula, screen and design token.
> §2 below mirrors the migration — if they ever differ, the migration is right
> and §2 needs updating, not the other way round.
>
> **Reconciled edition (Sep 2026).** Schema and ingestion sections are updated to
> agree with `PACKS.md`: `assets` is pack-aware, the old `benchmarks` table is now
> generic `series_points`, `user_settings` carries `base_currency`, `prices`
> carries `currency`, and ingestion is done by pack adapters rather than six
> hardcoded sources. Calculation formulas and screens are unchanged in substance,
> generalized from "BRL" to "base currency".

---

## 1. Architectural decisions (rationale)

The principles in `ARCHITECTURE.md` §4 restated with the trade-offs that drove
them. Re-read the relevant one before deviating.

### 1.1 Event-sourced ledger (no positions table)

Positions derive from `transactions` on every read; the only denormalized state
is `portfolio_snapshots`, a deterministic function of transactions + prices +
series. **Why:** a `positions` table updated per transaction creates a sync-bug
surface that compounds — any historical correction silently invalidates
downstream numbers unless the sync logic is perfect. Event sourcing makes
corrections trivial: edit the transaction, everything recomputes. **Cost:** more
compute per read, mitigated by the snapshot cache and the modest size of a
personal ledger.

### 1.2 Native storage, base-currency display, decompose at read

`prices.price` is native currency. Aggregations convert at read time using the
same-day FX series. **Why:** storing pre-converted values loses the information
needed to answer "how much of my gain was FX?" The decomposition
`(1 + R_base) = (1 + R_native) × (1 + R_fx)` only works if both components are
recoverable. **Cost:** every base-currency read joins the FX series for the date;
small, well-indexed, acceptable.

### 1.3 RLS everywhere; service role only in cron

Every user-data table has `user_id` and an RLS policy. `series_points` and
`ingest_cursors` are global tables with no `user_id` and no RLS; the migration
revokes write privileges from `anon`/`authenticated` so only cron (service role)
can write. **Why:**
RLS is the single mechanism that makes the codebase multi-user-ready without
auditing every query.

### 1.4 Money is decimal

All monetary math uses `decimal.js` via `lib/calc/money.ts`. The pack boundary passes
values as strings so a stray `parseFloat` can't enter. **Why:** floats silently
corrupt money.

### 1.5 Packs supply data, never math

The kernel owns a closed set of four valuation strategies and six series kinds.
Instruments and benchmarks from any country map onto those. **Why:** this is what
lets a UK contributor add gilts and SONIA without touching `lib/calc/` — and what
keeps every self-hoster running only reviewed code. Full contract: `PACKS.md`.

---

## 2. Schema (`supabase/migrations/20260905000000_initial_schema.sql`)

Authoritative, executable DDL and every integrity constraint live in the
migration; this section is a readable shape, not a substitute for applying or
reviewing that file. Column names follow the migration (`trade_date`,
`unit_price`, `fees`, `note`, `source_id`).

```sql
-- Closed set of ledger event types. dividend/interest/fee affect MWR and cash,
-- never quantity (§11).
create type txn_type as enum ('buy', 'sell', 'dividend', 'interest', 'fee');

-- Currencies are char(3) ISO 4217, validated both in the app and by DB checks.

-- USER SETTINGS
create table user_settings (
  user_id       uuid primary key references auth.users on delete cascade,
  base_currency char(3) not null default 'BRL',    -- display currency (§1.2)
  enabled_packs text[]  not null default '{}',      -- draft packs are never enabled by default
  locale        text    not null default 'pt-BR',   -- number/date formatting only
  theme         text    not null default 'system',  -- 'system' | 'light' | 'dark'
  last_export_at timestamptz,                      -- backup reminder (§12.3); null = never exported
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ASSETS (pack-aware; no asset_class enum — PACKS §3.1)
create table assets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  pack_id          text not null,                  -- 'br', 'us', 'global'
  instrument_kind  text not null,                  -- 'br.tesouro_direto', 'br.fii'
  identifier       text not null,                  -- ISIN / ticker / custom, per InstrumentKind.identifier
  name             text not null,
  native_currency  char(3) not null,
  metadata         jsonb not null default '{}',    -- pack-owned zod schema (PACKS §5)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- TRANSACTIONS (the event-sourced ledger; PACKS §3.5: packs never touch it)
create table transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  asset_id    uuid not null,              -- composite FK (asset_id,user_id) prevents cross-owner references
  trade_date  date not null,
  type        txn_type not null,
  quantity    numeric(24,10) not null,   -- signed: buy +, sell −; 0 for dividend/interest/fee
  unit_price  numeric(24,10) not null,   -- native currency, per unit (cash amount for dividend/interest/fee)
  currency    char(3) not null,          -- quote currency at trade time
  fees        numeric(24,10) not null default 0,
  fx_rate     numeric(24,10),            -- native→base on trade day; null if native == base
  note        text,
  created_at  timestamptz not null default now()
);

-- CASH_FLOWS (external deposits/withdrawals, for TWR/MWR)
create table cash_flows (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users on delete cascade,
  date     date not null,
  amount   numeric(24,10) not null,      -- + deposit, − withdrawal
  currency char(3) not null,
  note     text,
  created_at timestamptz not null default now()
);

-- PRICES (native currency; currency and source recorded — PACKS §3.4)
create table prices (
  asset_id  uuid not null references assets on delete cascade,
  date      date not null,
  price     numeric(24,10) not null,
  currency  char(3) not null,            -- quote currency at time of quote
  source_id text not null default 'manual',  -- pack source id ('br.brapi') or 'manual'
  primary key (asset_id, date)
);

-- SERIES_POINTS (generic market data — replaces `benchmarks`; PACKS §3.2)
-- Global, read-only to users, written by cron. NO user_id, NO RLS.
-- series_id is pack-namespaced: 'br.cdi', 'br.ipca', 'uk.sonia', 'global.usdbrl'.
-- The series' KIND and ROLES live in the pack manifest, not the DB.
create table series_points (
  series_id text not null,
  date      date not null,
  value     numeric(24,10) not null,
  tenor_days integer not null default 0, -- 0 scalar; >0 yield-curve maturity in days
  primary key (series_id, date, tenor_days)
);

-- INGEST_CURSORS (per-source resume markers for the single ingest cron — §7)
create table ingest_cursors (
  source_id   text primary key,          -- 'br.bcb_sgs'
  last_date   date,
  last_run_at timestamptz,
  last_error  text
);

-- PORTFOLIO_SNAPSHOTS (daily valuation cache; one row per user × asset × day)
create table portfolio_snapshots (
  user_id           uuid not null references auth.users on delete cascade,
  asset_id          uuid not null, -- composite FK (asset_id,user_id) prevents cross-owner references
  date              date not null,
  quantity          numeric(24,10) not null,
  price_native      numeric(24,10) not null,
  fx_rate           numeric(24,10),      -- null when native == base
  base_currency     char(3) not null,    -- the base this row was converted into (§11 lock rule)
  market_value_base numeric(24,10) not null,
  carried_forward   boolean not null default false,  -- built on carried-forward inputs (§11)
  created_at        timestamptz not null default now(),
  primary key (user_id, asset_id, date)
);
```

### 2.1 Indexes

```sql
create index assets_pack_kind_idx             on assets (pack_id, instrument_kind);
create index assets_user_idx                  on assets (user_id);
create index transactions_user_asset_date_idx on transactions (user_id, asset_id, trade_date);
create index transactions_user_date_idx       on transactions (user_id, trade_date desc);
create index cash_flows_user_date_idx         on cash_flows (user_id, date desc);
create index snapshots_user_date_idx          on portfolio_snapshots (user_id, date desc);
```

The migration additionally enforces transaction signs by type, positive prices
and FX rates, valid currencies/themes, unique per-user asset identity, and
owner-matching composite foreign keys. The `prices` and `series_points` primary
keys already serve their date-range scans; duplicate descending indexes are not
created.

---

## 3. Row-level security (same migration)

```sql
alter table user_settings        enable row level security;
alter table assets               enable row level security;
alter table transactions         enable row level security;
alter table cash_flows           enable row level security;
alter table prices               enable row level security;
alter table portfolio_snapshots  enable row level security;
-- series_points, ingest_cursors: NO RLS. Global data written only by the
-- service role in cron. Do not add a user_id or an RLS policy here.

create policy "own settings" on user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own assets" on assets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own transactions" on transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own cash flows" on cash_flows
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "read own snapshots" on portfolio_snapshots
  for select using (auth.uid() = user_id);

-- prices are scoped through the parent asset; authenticated clients can mutate
-- only rows whose resulting source_id is 'manual'. Pack provenance and all
-- snapshot writes are service-role-only. See the migration for verb policies.

-- Supabase grants anon/authenticated ALL on new public tables by default.
-- Without these revokes, any anon-key holder could write market data.
revoke all    on series_points  from anon, authenticated;
grant  select on series_points  to   authenticated;
revoke all    on ingest_cursors from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on portfolio_snapshots from anon, authenticated;
```

---

## 4. Valuation strategies (closed set — `lib/calc/valuation/`)

Every instrument kind maps to exactly one. The kernel implements these four and
no more; adding a fifth is a reviewed kernel change (`PACKS.md` §5).

```ts
type ValuationStrategy =
  | { kind: "market_price"; sourceId: string }
  | { kind: "nav_unit_price"; sourceId: string }
  | { kind: "accrual"; convention: AccrualConvention }
  | { kind: "curve_mark_to_market"; seriesId: string };
```

- **market_price** — last observed traded price (equities, ETFs, FIIs, crypto).
- **nav_unit_price** — fund-published unit price (open-ended funds, previdência).
  Separate from market_price because staleness tolerance differs.
- **accrual** — value compounds from a contracted rate (CDB/LCI/LCA; UK fixed
  deposits). `AccrualConvention` carries day-count (`BUS/252` | `ACT/365` |
  `ACT/360` | `30/360`), compounding, and an optional index mode
  (`percent_of_index` for "110% do CDI", `index_plus_spread` for "IPCA + 6%").
- **curve_mark_to_market** — present value of remaining cash flows off a curve
  (Tesouro Direto, gilts, Treasuries). Reads the cash-flow schedule from the
  instrument's `metadata` (`maturity`, `coupon`, `indexation`).

`lib/calc/valuation/` exposes one pure function: `value(strategy, holding, prices, series, date)
→ Money` in native currency. Base-currency conversion is a separate step (§6).

---

## 5. Series kinds (closed set — `lib/calc/series/`)

```ts
type SeriesKind =
  | { kind: "rate_daily"; dayCount: DayCount }
  | { kind: "rate_annual"; dayCount: DayCount }
  | { kind: "index_level" }
  | { kind: "inflation_index"; interpolation: "none" | "linear_daily" }
  | { kind: "fx_rate"; base: CurrencyCode; quote: CurrencyCode }
  | { kind: "yield_curve"; tenors: number[] };
```

The kernel owns one cumulative-return function per kind: `rate_daily` compounds,
`index_level` chains, `inflation_index` deflates, `fx_rate` converts,
`yield_curve` discounts. A pack registering SONIA as `rate_daily` reuses CDI's
exact compounding path. Series carry `roles` (`benchmark`, `deflator`,
`accrual_index`, `discount_curve`, `fx`) that drive the UI: anything with
`benchmark` appears in the Performance toggles; anything with `deflator` is
selectable for real returns.

Rates cross the adapter boundary in unit form (`"0.12"` means 12%), index kinds
cross as levels, and FX crosses as quote units per base unit. Yield curves store
one `series_points` row per declared tenor using `tenor_days`; scalar series use
zero. An adapter must reject data it cannot normalize safely.

---

## 6. Calculations (`lib/calc/`) — all pure functions

**Positions** (`positions.ts`): **lots**, derived from the ledger, never stored.
Transactions are processed in `(tradeDate, rank, id)` order with
`buy < dividend = interest = fee < sell`, so a same-day round trip never
oversells. A buy opens a lot; a sell consumes lots **FIFO**; dividend, interest
and fee touch no lot. Lots are kept rather than a bare quantity because
`accrual` values each lot from its own purchase date.

A sell beyond the open position is `oversell`. It is **refused at write** — by
the transaction form, by an edit that would leave later sells uncovered, and by
the CSV import's preview (§9.1) — so the ledger cannot normally hold one. A
ledger that does (a restored backup, which the database writes without running
the kernel — §12.3) is **shown, not computed**: the asset's row says so and
every derived screen says so, rather than failing.

**Cost** (`positions.ts`): `openCost = Σ quantity × unitPrice` over the open
lots, `averageCost = openCost / quantity` (null at zero quantity), and
`unrealised = market value native − open cost`. All three are **trade cost
before fees**, and are labelled so on screen. Fees are not capitalised into
cost: a fee-inclusive average is the fiscal "preço médio", which ARCHITECTURE §2
keeps out of this project permanently. Fees enter the figures that are about
money in and out — `investedFlows`, `netInvested`, Contribution and MWR.

**Valuation → base** (`valuation/` + `fx.ts`): value each holding natively via
its strategy, then convert:
`value_base = value_native × fx(native→base, date)`. `fx.ts` resolves the pair
via a direct `fx_rate` series where one exists, else triangulates through USD and
marks the result derived. Missing observations carry forward up to the calendar's
longest holiday run + 1 day; beyond that the valuation is **flagged stale, not
estimated**.

**TWR** (`twr.ts`): geometric chain of sub-period returns, breaking the series at
every external cash flow so deposit/withdrawal timing is neutralized. This is the
number compared against benchmarks.

**MWR / XIRR** (`mwr.ts`): internal rate of return solving
`Σ CF_t / (1+r)^{t} = 0` over the user's actual dated cash flows (Newton, with
bisection fallback). "What did I personally earn."

**Contribution** (`contribution.ts`): `weight_i × return_i` per asset over the
period; sums to portfolio return.

**Attribution** (`attribution.ts`): for foreign-currency holdings, split total
base-currency return into asset and FX components via
`(1 + R_base) = (1 + R_native) × (1 + R_fx)`.

**Real returns** (`real.ts`): deflate a nominal base-currency return by a series
with the `deflator` role (IPCA for BRL, CPIH for GBP): `(1+R_nom)/(1+π) − 1`.

Every function is input→output, no Supabase inside. `pnpm test:calc` is the
project's most important suite.

---

## 7. Ingestion (pack adapters — `GET /api/cron/prices`)

The cron handler takes the union of every user's `enabled_packs`, resolves each
pack's declared `dependencies` transitively (`br` pulls in `global` for USDBRL),
and for each resulting pack calls its `PriceSource` adapters (`PACKS.md` §7).
Adapters:

- fetch via `ctx.http` (never global `fetch`) so rate limits, backoff, user-agent,
  and record/replay fixtures apply;
- return points as **decimal strings** with an explicit `currency`;
- are disabled cleanly when their optional API key env var is absent (dependent
  instruments show unpriced, with a reason; nothing crashes).

Writes go to `prices` (per-asset native quotes) and `series_points` (market
series), both idempotent on `(…, date)`; per-source progress is recorded in
`ingest_cursors`. The BR pack's initial sources map from
the original six: Tesouro Transparente, brapi.dev, BCB SGS live in `packs/br`;
CoinGecko, a Yahoo `market_price` source, and PTAX FX live in
`packs/global` (AwesomeAPI deferred until a series needs it — `MILESTONES.md`
Milestone 1 decisions).

**Cron authentication.** Both cron routes are `GET` (Vercel Cron issues GET)
and require `Authorization: Bearer ${CRON_SECRET}`, checked before any work.
Reject with 401 otherwise. Vercel sends the header automatically; manual
invocation uses the same header. Schedules live in `vercel.json`.

**Cron budget.** This project ships two cron jobs by design (Vercel Hobby
currently allows far more, each at most daily). Do not create one job
per pack. The single ingest job iterates all enabled packs' sources within one
invocation, with a per-source time budget and resume markers so a slow source
can't starve the rest.

---

## 8. Snapshots (`GET /api/cron/snapshots`)

Derive positions, value each holding via its strategy, convert to base, write
`portfolio_snapshots` (one row per asset, `carried_forward` set when any input
was carried forward). Idempotent per `(user_id, asset_id, date)`.

**Always incremental, from a marker.** For each user the job builds forward
from `max(snapshot date) + 1` — or the earliest transaction date when no
snapshot exists — up to the last business day, one day at a time in date
order, committing per day, within the same per-invocation time budget as
ingestion (§7). The marker is the data itself: no cursor table, nothing to
drift. There is no `backfill` parameter; a first run and a rebuild are simply
long incremental runs.

**Invalidation.** Any write that changes history — a backdated or edited
transaction (§1.1), a CSV import (§9.1), a manual price for a past date —
deletes that user's snapshots from the earliest touched date forward. The next
run rebuilds them. Never patch a snapshot in place.

**Triggers.** The nightly cron (all users); after an import commit and after
an asset's first price arrives (§9.4); and the Refresh control (§9.2). If the
time budget runs out mid-rebuild, the status strip shows _history rebuilding
A → B of today_ derived from the gap between the marker and the last business
day, and the next trigger continues from where it stopped. Real portfolios
have years × assets of daily rows; this is why the job is resumable rather
than synchronous. A gap that stops closing is a stalled rebuild, and the strip
says so rather than repeating _rebuilding_ forever (§9.2).

**Growth.** Nothing is pruned in v1, and the arithmetic is small enough to say
why. Per pack, `series_points` grows by roughly `series × 252` rows a year — a
few thousand, shared by every user of the instance. Per user, `prices` and
`portfolio_snapshots` each grow by roughly `assets × 252` rows a year: a
twenty-asset ledger over ten years is about 100k rows in each, comfortably
inside a free Postgres tier. Settings → Instance (§12.3) shows the live counts
so the estimate is never the only evidence. Ingested price history is also the
part of a lost database that cannot be re-fetched (§12.3), which is an argument
for exporting backups, not for deleting rows.

**Budgets.** Over a five-year, twenty-asset ledger: `runSnapshots` builds at
least 50 days per second; every read a page performs is under 500 ms at p50; and
`parseCsv` reads a 20,000-row file in under 500 ms. Measured numbers, the
machine they were measured on and how to re-run them live in
`docs/performance-budgets.md`.

---

## 9. Screens

Ten screens. Server components fetch; client components handle toggles/forms.

1. **Overview** — total value in base currency, day/period change, allocation
   donut, sparkline of portfolio value, top movers. **Top movers** are the five
   largest absolute base-currency changes between the last two snapshot dates,
   confident rows only: a stale row on either date drops that asset rather than
   reporting a move that the data does not support.
2. **Performance** — portfolio TWR vs a togglable set of benchmark-role series;
   MWR/XIRR figure; nominal-vs-real toggle (uses a deflator-role series). The
   **period selector** is `1m · ytd · 1y · all`, shared with screen 4: each
   period's nominal start resolves to the latest snapshot date at or before it,
   so the first sub-period has a start value to chain from; the default is `all`
   while the history is shorter than a year and `1y` after that; a period with no
   snapshot at or before its start is not offered.
3. **Allocation** — by instrument kind, by pack/country, by currency; native vs
   base exposure.
4. **Contribution** — per-asset contribution bars for the period (screen 2's
   selector); drill into any foreign-currency asset to see asset-vs-FX
   attribution.
5. **Maturities** — fixed-income ladder: upcoming maturities and the cash flow
   each generates; timeline view.
6. **Assets** — **the positions screen**, and the registry. Each row carries the
   holding's quantity today from its FIFO lots (§6), average cost and open cost
   _before fees_, the latest price with its state, market value in the base
   currency, and unrealised gain with a sign and an arrow. An asset with no
   transactions shows "—" rather than a zero; an unpriced or stale holding shows
   no unrealised figure, because a gain computed off a price the app does not
   trust is worse than no figure (§11). The table's foot carries the confident
   total and, when any holding is outside it, says how many. The asset's own page
   lists its open lots and adds/edits it: the entry form picks pack → instrument
   kind → (kind-specific metadata fields validated by the pack's zod schema) →
   native currency.
7. **Transactions** — list + create/edit; editing recomputes everything (§1.1).
   The list **filters** by asset, type and date range, because §9.1's own premise
   is a user arriving with years of history; filters are applied by the database
   before paging, the pager preserves them, an invalid filter value is ignored
   field by field (a filter is navigation, not input), and the filtered count is
   shown. `?asset=` — the link Maturities uses to record a sell — both filters
   the list and preselects the form, so the sell is entered with that asset's own
   history on screen. Also the home of **CSV import** (§9.1), the bulk path into
   the ledger.
8. **Cash flows** — deposits/withdrawals entry (feeds TWR/MWR), in the base
   currency only (`MILESTONES.md` §2 decision 25). The column exists for a
   multi-currency ledger and the kernel already converts at the flow date;
   entering one is Milestone 5.
9. **Settings** — base currency, enabled packs, theme, locale; security
   (change password, enrol/remove TOTP, sign out everywhere — §9.6); your data
   (export, backup reminder, delete everything — §12).
10. **Login** — email + password, TOTP challenge when enrolled; signups
    disabled (§9.6).

### 9.1 CSV import (screen 7)

Manual entry is the fallback, not the on-ramp: a new user arrives with years of
history. Import is the only bulk path in, and it stays a **file the user
uploads**, never a broker credential the app holds (ARCHITECTURE §2).

**Format.** One canonical CSV, documented in-app and in `README.md`. Header row
required; column order irrelevant; unknown columns ignored.

```
date,type,pack,instrument_kind,identifier,quantity,unit_price,currency,fees,note
2024-03-14,buy,br,br.fii,HGLG11,100,162.40,BRL,2.50,
2024-06-28,dividend,br,br.fii,HGLG11,0,132.00,BRL,0,June distribution
```

`type` is the `txn_type` enum (§2). `quantity`, `unit_price`, `fees` are read as
**strings straight into decimal.js** — never `parseFloat`, exactly as at a pack
boundary. `date` is `YYYY-MM-DD`. Broker exports differ, so the upload offers a
**column-mapping step**: the user maps their headers onto the canonical ones
once, and the mapping is remembered per user. The kernel ships no
broker-specific parsers.

**Dry-run first, always.** Upload parses and validates but writes nothing. The
preview shows, per row: parsed values, validation errors, and whether the row
looks like a duplicate. A sell the ledger cannot cover is one of those validation
errors (`oversell`, §6, §11) — checked over the existing rows **plus the whole
file** in trade-date order, so a buy further down the file still covers a sell
above it when the buy is the earlier trade, and only a sell genuinely exceeding
the position on its date is marked. The user commits explicitly.

**Commit is all-or-nothing.** One transaction; any unresolved error aborts the
whole file. A half-imported ledger silently corrupts every downstream figure,
and the user has no way to see it happened.

**Asset resolution.** Rows match an existing asset on
`(pack_id, instrument_kind, identifier)`. Unresolved identifiers are listed in
the preview, where the user creates them inline — pack and instrument kind come
from the CSV, remaining metadata is prompted per the pack's `metadataSchema`.
Import never invents an asset silently.

**Duplicate detection.** A row duplicates an existing transaction when
`(asset_id, trade_date, type, quantity, unit_price)` matches. Duplicates are
skipped by default and listed; the user may force-include them (genuine
same-day repeat trades exist). Re-importing the same file must therefore be a
no-op — the property test worth writing.

**Not in scope for import.** Cash flows (screen 8) and assets-in-bulk. Import
writes `transactions` only.

### 9.2 Navigation

Two groups, always fully visible — a screen with no data yet still teaches
what the product does. Hiding routes until data exists is forbidden.

| Group        | Routes                                                                          |
| ------------ | ------------------------------------------------------------------------------- |
| **Analysis** | `/` Overview · `/performance` · `/allocation` · `/contribution` · `/maturities` |
| **Ledger**   | `/assets` · `/transactions` · `/cash-flows`                                     |
| —            | `/settings`, theme toggle (ARCHITECTURE §7), sign out; `/login` unauthenticated |

Top nav, hairline rule beneath, collapsing to a menu on narrow viewports
(mobile browsers are in scope, native apps are not — ARCHITECTURE §2).

**Status strip.** One line under the nav, present only when something is
pending: _N assets unpriced_ (§9.4), _history rebuilding 2019-03-01 → 2021-07-14
of 2026-09-05_ (§8), _source br.brapi disabled: BRAPI_TOKEN not set_. Each item
links to the screen that resolves it. It carries a single **Refresh** control
(§9.4) and nothing else — it is a status line, not a toolbar.

**Liveness.** The strip is also where the owner learns that the instance stopped
working, because there is no other channel: this project ships no
error-reporting SaaS by design (§12), so a cron that dies would otherwise rot an
instance in silence while stale prices carried forward. Three further items,
each derived from the data itself — never from a log, never from a new table:

| Item                                                   | When                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _no price run since 2026-09-12 — check the crons_      | The latest `ingest_cursors.last_run_at` across the user's activated sources is older than two trading days, and they hold something. Silent for an account's first two trading days. |
| _source br.brapi failing: 429_                         | That source's `ingest_cursors.last_error` is set.                                                                                                                                    |
| _history stopped at 2026-09-10; last built 2026-09-11_ | A snapshot gap exists (§8) **and** nothing has been written into it for two trading days — the rebuild is stalled, not progressing.                                                  |

Each links to Settings → **Instance** (§12.3), which states per source its last
run and its last error, the snapshot marker with the time it was last written,
and the instance's row counts.

### 9.3 First run

A fresh instance has one user (created by `pnpm bootstrap:user`, ARCHITECTURE
§8) and zero rows everywhere else. The user lands on Overview. **Overview
renders a setup card above its normal content** — there is no wizard route and
no "onboarding complete" flag. Every step is derived from row counts, so the
card disappears the moment the data exists and reappears if it is ever deleted.

| Step                 | Done when                                                             | Copy                                                                                                |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1. Base currency     | `user_settings.updated_at > created_at` **or** any transaction exists | "Base currency: BRL — change it before your first transaction; it locks after (§11)." → Settings    |
| 2. First asset       | `count(assets) > 0`                                                   | "Add what you hold: pack → instrument kind → identifier." → Assets                                  |
| 3. First transaction | `count(transactions) > 0`                                             | "Enter one by hand, or import a CSV of your history." → Transactions                                |
| 4. Priced            | every asset has ≥ 1 `prices` row                                      | Fills in automatically (§9.4); if a source is disabled or failing, says so and offers manual entry. |

Steps are ordered but never gated: a user may import a CSV before touching
Settings. Step 1 exists precisely so the base-currency lock is never a
surprise. Overview's real content renders beneath the card and fills in as
each step completes — the headline value appears at step 4, the sparkline
after the first snapshot, so the user watches the product come alive rather
than waiting behind a modal.

### 9.4 Price fetch on asset creation

Prices are fetched **automatically when an asset is created**, so a user does
not wait for the 21:30 cron to see a number. Two rules keep that from turning
the asset form into a network error surface:

1. **Save first, fetch second, never coupled.** The asset row commits in its
   own transaction. Only then does a server action call the ingest job
   (`lib/packs/ingest.ts`) scoped to the sources that price this asset's
   instrument kind, under the service role. A brapi 429 can therefore never
   fail "save asset".
2. **Outcome is shown on the asset, not the form.** The row goes _Fetching…_ →
   _162.40 BRL · br.brapi · today_ or → _Unpriced — br.brapi: 429 at 10:03.
   Retry · Enter a price_. The reason comes from `ingest_cursors.last_error`,
   which is per source — the true granularity — so no schema change.

The same scoped fetch runs for every asset created from a CSV import preview
(§9.1), and enabling a pack in Settings triggers its series sources once so
benchmarks exist before the first nightly run. A source with no API key is
reported immediately as disabled with the env var name; manual price entry
(`prices.source_id = 'manual'`, §2) is always available as the fallback.

**Refresh** (status strip, §9.2) is the retry and catch-up control: it re-runs
the scoped fetch for every currently unpriced asset and advances snapshot
rebuilding (§8). It reuses the cron code paths under the cron's time budget;
it is not a third cron and adds no scheduled job.

Refresh is **debounced on the server**: while a run it started is still within
its window it schedules nothing and says so, so ten impatient clicks are one
run. Overlapping runs are nonetheless safe rather than merely unlikely — a
Refresh during the nightly cron duplicates fetches under the same per-source
rate limit, and every write is an idempotent upsert keyed by date (§7, §8).
There is deliberately **no lease**: a lease row would be new user data (which
this milestone's migrations exclude), a Postgres advisory lock cannot span
PostgREST's per-request transactions, and a lease outliving a crashed run would
block the nightly cron — the failure it was meant to prevent, made permanent.

### 9.5 Empty states

Every derived screen, with no data, names what it _will_ show and links to the
action that unblocks it. Never a blank chart; never a fake zero.

| Screen                          | Needs                                                 | Empty copy → link                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview headline               | ≥ 1 priced position                                   | "—" with _N assets unpriced_ → Assets                                                                                                             |
| Overview sparkline / day change | ≥ 2 snapshots                                         | "History starts after tonight's snapshot."                                                                                                        |
| Performance                     | ≥ 2 snapshots **and** ≥ 1 `benchmark` series ingested | "Needs two days of history to plot a return." / "Benchmarks arrive with the nightly ingest."                                                      |
| Allocation                      | ≥ 1 priced position                                   | "Nothing to allocate yet." → Assets                                                                                                               |
| Contribution                    | snapshots spanning the chosen period                  | "Contribution needs history across the period."                                                                                                   |
| Maturities                      | ≥ 1 asset whose kind has maturity metadata            | "No fixed-income holdings yet. Add a Tesouro Direto, CDB, LCI…" → Assets                                                                          |
| Assets                          | —                                                     | "Add what you hold." + "or import a CSV — unknown identifiers can be created from the preview." An asset with no transactions shows quantity "—". |
| Transactions                    | —                                                     | "No transactions yet." + Add · Import CSV                                                                                                         |
| Cash flows                      | —                                                     | "Deposits and withdrawals are what separate your return from your contributions." + Add                                                           |
| Login                           | —                                                     | Email + password only. No signup link. One line: "Single-owner instance — the account is created with `pnpm bootstrap:user`."                     |

A position with quantity but no price renders with its quantity and
_unpriced_, never a value of zero; a stale one renders its last value with the
stale mark (§11). Both rules apply on every screen, not only Overview.

### 9.6 Login & sessions

**One owner, created out of band.** `pnpm bootstrap:user` (ARCHITECTURE §8) is
the only path that creates an account; Supabase signups are disabled at the
project level and the app has no signup route, form or link. The login page is
email + password and one line of copy explaining that.

**Second factor.** TOTP via Supabase Auth's built-in MFA, enrolled from
Settings (QR + confirm code). Once a factor exists, **every** session must
reach AAL2 before any data screen renders — a valid password alone gets the
challenge page, nothing else. Unenrolled users stay at AAL1 with no nag beyond
one line in Settings. Recovery is the CLI (`pnpm bootstrap:user --reset-mfa`,
service role), never an email link: a mailbox must not be able to strip the
second factor from a finance dashboard.

**Password reset** uses Supabase's reset email; the CLI covers the case where
email is down. Failure copy is uniform — "email or password incorrect" — and
attempt throttling is Supabase Auth's own.

**Sessions.** Cookie-based via `@supabase/ssr`: `httpOnly`, `Secure`,
`SameSite=Lax`. Server code establishes identity with `getUser()` (verified
against Auth) — never `getSession()`, which trusts the cookie unverified.
Tokens refresh at the request layer. Settings offers _sign out everywhere_
(global scope). No "remember this device" beyond the refresh token's own life.

**What auth never does.** No OAuth providers by default (each is a third party
that learns you use a portfolio tracker), no analytics on the login page, no
account enumeration through differing error copy or timing.

---

## 10. Design system

**Aesthetic.** Editorial/financial, FT-style. Restrained, data-first, generous
whitespace, hairline rules.

**Type.** Instrument Serif for display headings and large figures; system
sans-serif stack for body, tables, and controls. Tabular numerals for all
monetary and percentage figures.

**Colour tokens** (both themes first-class; system preference + manual toggle):

```
--bg / --bg-subtle / --surface / --border-hairline
--text / --text-muted
--pos (gains) / --neg (losses)   -- must remain distinguishable in both themes
--accent                         -- single editorial accent, used sparingly
```

Never rely on `--pos`/`--neg` colour alone to carry meaning — pair with sign and,
where space allows, a small arrow.

**Charts (Recharts).** Thin strokes, no heavy gridlines, direct labeling over
legends where feasible. Benchmark comparison lines are muted; the portfolio line
is the accent. Currency and percentage axes formatted per the user's `locale`.

**Accessibility.** The floor, not an aspiration — this is the one screen-facing
requirement a design system can guarantee rather than hope for:

- **Contrast** meets WCAG AA in **both** themes: 4.5:1 for body text, 3:1 for
  large text and for the boundary of any control or mark that carries meaning.
  The token pairs are asserted by a test, not by eye.
- **Focus** is always visible, and every control is reachable and operable by
  keyboard in a sensible order. Nothing is hover-only.
- **Motion**: `prefers-reduced-motion` stops chart animation and transitions.
- **Width**: no horizontal scroll at 400 px. Tables that cannot fit become
  stacked cards; a genuinely wide table scrolls inside its own container, never
  the page.
- **Announcements**: the status strip is `aria-live="polite"`; a form error names
  the field in its copy, and marks it `aria-invalid` — never colour alone (as
  with `--pos`/`--neg` above).

The per-screen walk that proves it, dated, is `docs/accessibility.md`.

---

## 11. Edge cases (decide these once, here)

- **Base currency change after transactions exist.** v1: lock base currency at
  first transaction; changing it offers an explicit "recompute history" reset
  rather than silently reinterpreting.
- **Stale FX / price.** Carry forward within the calendar staleness window; beyond
  it, flag the position stale in the UI — never print a confident converted value
  off missing data.
- **Non-overlapping market calendars.** When a holding's market and the FX series
  disagree on a trading day, both carry forward under the same rule; the snapshot
  records it was built on carried-forward inputs.
- **Local-currency-quoted, foreign-exposed instruments** (BDRs, hedged ETFs).
  Known gap: the naive decomposition reports zero FX contribution, which is wrong.
  Documented per instrument kind; not solved in v1.
- **Dividends/interest** enter as `transactions` of the matching `txn_type`; they
  affect MWR and cash position but not quantity.
- **Backdated transactions** (hand-entered or imported, §9.1) land before
  existing `portfolio_snapshots`. Snapshots are a pure function of the ledger, so
  every snapshot from the earliest touched date forward is invalidated and
  rebuilt by the next snapshot run (§8) — never patched in place, never left
  stale.
- **A sell beyond the open position** is `oversell` (§6). It is refused at write
  by the transaction form, by an edit that would leave later sells uncovered, and
  by the import preview, which marks the row and blocks the commit like any other
  row error. It is refused rather than clamped or allowed to go negative because
  a negative position poisons every figure downstream silently, while a refusal
  names the row that is wrong. Only a restored backup can introduce one, since
  `restore_backup` is a database transaction and cannot run the kernel; that
  ledger is shown with the asset marked, not computed.
- **Disabling a pack whose assets are still held** is refused (`pack_in_use`).
  The setting would otherwise be a lie: a held asset's pack is activated for
  valuation whatever the setting says, so the holding would keep being priced and
  valued while Settings claimed the pack was off. Delete or re-home the assets
  first.
- **A stale date is not a valuation point.** A date enters the TWR chain and the
  cumulative line only when _every_ asset with open lots on it has a confident
  row — no stale row, and no holding missing a row because it was unpriced (an
  unpriced holding leaves no row at all, so the row count is compared with the
  open holdings). A failing date is excluded, drawn as a gap, and counted: the
  screen states the span the figures cover and how many days were left out. Its
  confident total omits a holding, and chaining it would read as a move that
  never happened.

---

## 12. Data & privacy

The promise, stated plainly so nobody infers a stronger one:

> **You run the server, and the server sees your data.** Your portfolio lives
> as plaintext rows in _your own_ Supabase project, encrypted at rest and in
> transit by Supabase. The app that reads it runs on _your own_ Vercel account.
> Nothing is end-to-end encrypted, because the kernel computes on the server
> (§6, §8). No one else — including this project's maintainers — has a copy.

### 12.1 What leaves an instance

| Leaves to                                                                    | Carries                                                               | Never carries                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| Pack sources (brapi, BCB SGS, IBGE SIDRA, Tesouro Transparente, BCB PTAX, …) | ticker / series codes, the source's API token, the project user-agent | quantities, prices paid, values, currency totals, identity |
| Vercel                                                                       | the app, its logs, env vars (including the service-role key)          | —                                                          |
| Supabase                                                                     | everything, at rest + TLS                                             | —                                                          |
| Anyone else                                                                  | **nothing**                                                           | —                                                          |

Sources therefore learn _what_ a self-hoster holds, never _how much_. That is
disclosed in `README.md` and in Settings. A source whose terms would let it
learn more is a licence question (`packs/LICENSES.md`), not a pack decision.

**No third parties by default.** No analytics, no telemetry, no error-reporting
SaaS, no chat widget, no CDN-loaded script. Fonts are self-hosted through
`next/font` — build-time download, served from the app's own origin — so a page
view never touches Google. Anything of this kind is opt-in through an env var
and listed in this section when added.

### 12.2 Logging rule

Logs record **ids, counts, status codes and durations — never row values.**
Not a quantity, not a price, not a total, not a note. Pack HTTP logging records
`source_id` and status, never a full URL: brapi passes its token as a query
parameter, and a URL in a log is a token in a log. Enforced by review; a
helper in `lib/packs/http.ts` redacts before anything reaches a logger.

### 12.3 Your data (Settings)

**Instance.** What the strip's liveness items (§9.2) link to, and the one place
the owner can see whether the machinery is running. Per source of the activated
packs: its last run, its last error as a reason phrase, or _disabled_ with the
name of the environment variable it wants. Then the snapshot marker — the date
history is built through, and when that was last written. Then the row counts:
assets, transactions, cash flows, prices and snapshot rows exactly (through the
owner's own RLS), and `series_points` approximately, labelled as the shared
market data it is (§2). No value, no URL, no secret — the same rule as §12.2,
because this block is the logging rule rendered as a screen. It states that
nothing is pruned (§8) and that the export is what makes ingested history
survivable.

**Export.** Two files, dated: `transactions-YYYY-MM-DD.csv` in the §9.1
canonical format — so the app's own import reads it back — and
`finance-finder-YYYY-MM-DD.json`, a complete dump:
`{ version: 1, exported_at, settings, assets, transactions, cash_flows,
prices }`. `prices` carries **every** price row with its `source_id`, not only
manual ones (MILESTONES.md §2 decision 3): brapi's free plan cannot backfill
beyond three months, so ingested history lost with the database is lost for
good unless the backup carries it. `settings` is
`{ base_currency, enabled_packs, locale, theme }` (decision 18). Money as
decimal strings, as at every boundary; `user_id` is never in the file. Each
export stamps `user_settings.last_export_at`. The database produces the file
through `export_backup()` (security invoker, RLS-scoped); `lib/backup`
validates it (`parseBackup`) and writes it deterministically
(`serializeBackup`: stable row order, fixed key order, canonical decimals), so
two exports of the same ledger are byte-identical except `exported_at`.

**Restore.** Only into an **empty** account — no assets, transactions or cash
flows — else refused with a fixed reason; merge is a different feature. Row
ids and `created_at` are preserved, `user_id` is always rewritten to the
restoring user, and an asset whose pack or instrument kind this build does
not know, or whose metadata fails the pack schema, is restored with a warning
and shows as unpriced (decision 4). `restore_backup(jsonb)` is one database
transaction with `security definer` rights, because the client-side `prices`
policy admits only manual rows; being the trust boundary it enforces
ownership itself (decision 11): it refuses when unauthenticated, when the
account is not empty, when an asset id already exists for any user, or when a
transaction or price names an asset outside the restored set. The refusal
codes are `not_authenticated`, `unsupported_version`, `account_not_empty`,
`duplicate_asset_id`, `asset_id_conflict`, `foreign_asset_reference` and
`invalid_rows` (a row the database itself refuses — a negative price, an
unknown type — reported as the same fixed shape rather than a raw error).
Concurrent restores into one account are serialised by a per-user advisory
lock, so the second sees `account_not_empty`.

**Proof.** `lib/backup/roundtrip.dbtest.ts` (`pnpm test:db`, against a real
Postgres) seeds the BR golden portfolio for a throwaway user, exports, deletes
the user and checks every user table cascaded, restores into a NEW user,
exports again and asserts equality modulo `exported_at`; then runs the kernel
over the restored rows and matches `packs/br/fixtures/expected.json`. It also
proves a file naming another user's asset ids is refused with nothing
written, and that the service role can call neither function.

**Backup reminder.** Supabase's free tier keeps no automated backups. Settings
shows the last export date and the status strip (§9.2) nudges once
`last_export_at` is older than 30 days or null with data present. Dismissable
per occurrence, never permanently.

**Delete everything.** Type-to-confirm plus a fresh password entry, then a
server action deletes the `auth.users` row under the service role; every
user-scoped table cascades (§2). `series_points` is untouched — it was never
user data. Redirect to login; the instance is back to its bootstrap state.

**Privacy mode.** A toggle beside the theme switch masks every monetary amount
and quantity (`•••`); names, percentages and returns stay visible. Client-only,
remembered per device in `localStorage`, never stored server-side — it is a
display preference for screen-sharing, not a security boundary.

### 12.4 Not done, and why

- **Column encryption (Vault/pgsodium)** — would protect a leaked DB dump, but
  the app decrypts at runtime so the trust model is unchanged. Revisit if a
  contributor needs it; not a v1 gain.
- **End-to-end encryption** — a different architecture (`lib/calc` in the
  browser, no snapshot cron). Out of scope, permanently, unless the kernel
  changes.
- **Multi-user** — the schema is ready (ARCHITECTURE §4.7) and RLS isolates
  users, but opening signup is a deliberate config change, not a default.
