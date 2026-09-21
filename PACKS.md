# PACKS.md — Market pack architecture

Fourth document alongside `ARCHITECTURE.md`, `SPEC.md`, `MILESTONES.md`.
Defines how contributors add countries, currencies, instruments and data sources
without modifying the kernel.

Status: draft for a codebase that does not yet exist. Written to be implemented
alongside Milestone 1, not retrofitted.

---

## 1. The one rule

> **Packs supply data, identifiers and mappings. Packs never supply math.**

A UK contributor does not write a gilt valuation function. They declare that a
gilt is a `curve_mark_to_market` instrument and point at the series that feeds
the curve. The kernel already owns that math because Tesouro Direto needed it.

If a contribution genuinely requires new math, that is a kernel pull request with
your review, a new entry in a closed union type, and unit tests. That friction is
intentional and is the mechanism that protects `ARCHITECTURE.md` §4.

Corollary: **a pack that cannot be expressed with the existing strategies is a
signal about the kernel, not about the pack.** Two packs independently needing
the same missing strategy is the threshold for adding one.

---

## 2. Kernel / pack boundary

| Concern                                         | Owner  | Notes                             |
| ----------------------------------------------- | ------ | --------------------------------- |
| `transactions` table and position derivation    | Kernel | ARCHITECTURE §4.1, untouchable    |
| TWR, MWR/XIRR, contribution, FX attribution     | Kernel | `lib/calc/`, pure functions       |
| `Money` / decimal.js discipline                 | Kernel | ARCHITECTURE §4.4                 |
| RLS policies, auth, `user_id` scoping           | Kernel | ARCHITECTURE §4.3                 |
| Valuation strategies (closed set)               | Kernel | §5 below                          |
| Series kinds and their return math (closed set) | Kernel | §6 below                          |
| FX resolution and triangulation                 | Kernel | §8 below                          |
| Screens, design system, charts                  | Kernel | Packs supply labels only          |
| Database migrations                             | Kernel | **Packs ship zero migrations**    |
| npm dependencies                                | Kernel | Packs add none                    |
| Which instruments exist in a market             | Pack   | §4                                |
| Which series exist and what they mean           | Pack   | §6                                |
| How to fetch prices and series                  | Pack   | §7                                |
| Trading calendar, day-count conventions         | Pack   | §9                                |
| Instrument-specific fields                      | Pack   | via `metadata` jsonb + zod schema |
| Currency of denomination                        | Pack   | ISO 4217                          |

---

## 3. Schema changes to `SPEC.md`

Five changes. All are to be made in the initial migration, before any pack
exists, so no pack ever ships SQL.

### 3.1 `assets` becomes pack-aware

```sql
alter table assets
  add column pack_id          text not null,       -- 'br', 'uk'
  add column instrument_kind  text not null,       -- 'br.tesouro_direto'
  add column native_currency  char(3) not null,    -- ISO 4217
  add column metadata         jsonb not null default '{}';

create index on assets (pack_id, instrument_kind);
```

The Brazil-specific asset-class enum in `SPEC.md` is deleted. `metadata` holds
whatever the instrument kind needs — TD maturity and index type, a gilt's coupon
and redemption date — validated in application code by the pack's zod schema,
never by the database.

### 3.2 `benchmarks` becomes a generic series table

```sql
create table series_points (
  series_id text        not null,   -- 'br.cdi', 'uk.sonia', 'global.usdbrl'
  date      date        not null,
  value     numeric(24,10) not null,
  tenor_days integer    not null default 0, -- 0 scalar; >0 yield-curve maturity
  primary key (series_id, date, tenor_days)
);
```

This table is **global public market data, not user data**. It carries no
`user_id`. Writes come only from cron via the service role (ARCHITECTURE §4.3 is
about user-scoped tables; state this explicitly in the migration comment so a
future reviewer does not "fix" it by adding RLS). Because Supabase grants
`anon`/`authenticated` full privileges on new public tables by default, the
migration must `revoke all` from those roles and `grant select` back — no RLS
does not mean no access control.

The USDBRL series from the original spec is no longer special. It is
`global.usdbrl`, a series with `kind: fx_rate` registered by `packs/global`.

### 3.3 `user_settings` gains base currency

```sql
alter table user_settings
  add column base_currency char(3) not null default 'BRL',
  add column enabled_packs text[]  not null default '{}',
  add column locale        text    not null default 'pt-BR';
```

"BRL is the display currency" (ARCHITECTURE §4.2) becomes "the user's
`base_currency` is the display currency". The decomposition is unchanged:

```
(1 + R_base) = (1 + R_native) × (1 + R_fx)
```

`prices.price` remains in native currency. Nothing about §4.2's reasoning
changes — only the constant becomes a setting.

### 3.4 `prices` gains currency

```sql
alter table prices add column currency char(3) not null;
```

Denormalized from the asset deliberately: an instrument's quote currency can
change (redenomination, venue change) and historical prices must keep the
currency they were quoted in.

### 3.5 Nothing else

`transactions` and `portfolio_snapshots` are unchanged. If a pack proposal
requires touching either, reject it and open a kernel discussion instead.

---

## 4. The pack manifest

`packs/types.ts` is kernel-owned. Packs import from it and never edit it.

```ts
export const PACK_API_VERSION = 1;

export interface MarketPack {
  apiVersion: typeof PACK_API_VERSION;
  id: string; // ISO 3166-1 alpha-2, lowercase: 'br', 'uk'
  name: string; // 'Brazil'
  currency: CurrencyCode; // primary denomination currency
  locale: string; // BCP-47, for number/date formatting only
  instruments: InstrumentKind[];
  series: SeriesDescriptor[];
  sources: PriceSource[];
  calendar: MarketCalendar;
  maintainers: string[]; // GitHub handles; generates CODEOWNERS
  status: "draft" | "supported" | "unmaintained";
}
```

Every `id` a pack declares — instruments, series, sources — must be prefixed
with the pack id. `br.cdi`, not `cdi`. Enforced by the conformance suite. This
is what makes the global `series_points` namespace collision-free without
coordination between contributors.

### 4.1 Instrument kinds

```ts
export interface InstrumentKind {
  id: string; // 'br.tesouro_direto', 'uk.gilt'
  label: string;
  valuation: ValuationStrategy;
  metadataSchema: ZodType; // validates assets.metadata
  identifier: IdentifierSpec; // 'isin' | 'ticker' | 'custom'
  quoteCurrency: CurrencyCode;
}
```

---

## 5. Valuation strategies — closed set

The kernel implements exactly these four. Packs choose one per instrument kind.

```ts
export type ValuationStrategy =
  | { kind: "market_price"; sourceId: string }
  | { kind: "nav_unit_price"; sourceId: string }
  | { kind: "accrual"; convention: AccrualConvention }
  | { kind: "curve_mark_to_market"; seriesId: string };
```

**`market_price`** — last observed traded price in native currency. Equities,
ETFs, FIIs, crypto, investment trusts.

**`nav_unit_price`** — unit price published by the fund rather than a market.
Open-ended funds, previdência, UK OEICs. Distinct from `market_price` because
staleness tolerance differs: a NAV published D+1 is normal, a stale equity price
is a data incident.

**`accrual`** — value compounds from a contracted rate rather than a market
quote. CDB, LCI, LCA, UK fixed-rate bonds and cash ISAs.

```ts
export interface AccrualConvention {
  dayCount: "BUS/252" | "ACT/365" | "ACT/360" | "30/360";
  compounding: "daily" | "monthly" | "annual";
  index?:
    | { mode: "percent_of_index"; seriesId: string } // "110% do CDI"
    | { mode: "index_plus_spread"; seriesId: string }; // "IPCA + 6%"
}
```

Omitting `index` gives a plain fixed rate. These three modes cover every
Brazilian private-credit structure in the original spec and standard UK fixed
deposits — evidence the abstraction is at the right level.

An instrument kind whose `metadataSchema` includes `maturity: IsoDate` is
treated as a fixed-income holding by the Maturities screen (`MILESTONES.md`
§4 decision 38); the kernel never reads it (§2 decision 14) — a lot accrues
until a sell closes it.

**`curve_mark_to_market`** — value is the present value of remaining cash flows
discounted off a published curve. Tesouro Direto, gilts, US Treasuries.

The kernel needs the cash-flow schedule to do this. It comes from `metadata` via
a required shape that any instrument using this strategy must satisfy:

```ts
// Enforced by the conformance suite for curve_mark_to_market kinds
metadataSchema must extend z.object({
  maturity: z.string().date(),
  coupon:   z.object({ rate: DecimalString, frequency: 1 | 2 | 4 | 12 }).nullable(),
  indexation: z.object({ seriesId: z.string() }).nullable(),  // IPCA-linked, gilt linkers
})
```

This is the one place a pack's `metadata` is not free-form. Documented as a
kernel constraint, checked in CI, and the reason is stated in the error message.

---

## 6. Series kinds — closed set

```ts
export type SeriesKind =
  | { kind: "rate_daily"; dayCount: DayCount }
  | { kind: "rate_annual"; dayCount: DayCount }
  | { kind: "index_level" }
  | { kind: "inflation_index"; interpolation: "none" | "linear_daily" }
  | { kind: "fx_rate"; base: CurrencyCode; quote: CurrencyCode }
  | { kind: "yield_curve"; tenors: number[] };

export interface SeriesDescriptor {
  id: string;
  label: string;
  kind: SeriesKind;
  sourceId: string;
  roles: Array<"benchmark" | "deflator" | "accrual_index" | "discount_curve" | "fx">;
}
```

The kernel owns one cumulative-return function per kind. `rate_daily` compounds,
`index_level` chains, `inflation_index` deflates, `fx_rate` converts,
`yield_curve` discounts. A pack registering SONIA as `rate_daily` gets the
identical compounding path CDI uses, with no new code.

`roles` is what drives the UI. Anything with `benchmark` appears in the
comparison toggles; anything with `deflator` can be selected for real returns.
The original spec's "benchmarks with togglable UI" becomes "the BR pack
registers series with the benchmark role" (today: CDI, SELIC, IPCA, Ibovespa,
IFIX, plus USDBRL from `global`) — a data change, not a code change, and the UK
pack registering six more requires nothing of you.

`inflation_index` carries an interpolation policy because monthly inflation
prints against daily portfolio valuations is a real decision, and IPCA and CPIH
contributors should not each invent an answer silently.

**Series value units are part of the kernel contract.** Daily and annual rates,
inflation changes used to construct an index, and yield-curve rates are unit
rates (`"0.12"` = 12%), never percentage points. `index_level` is a level and
`fx_rate` is quote units per one base unit. Adapters normalize upstream units
using decimal-string operations. A `yield_curve` emits one point per tenor with
`tenorDays`; scalar series omit it and persist as `tenor_days = 0`.

---

## 7. Price source adapters

```ts
export interface PriceSource {
  id: string;
  label: string;
  homepage: string;
  license: string; // data licence, checked against an allowlist
  auth: "none" | "api_key";
  envVars?: string[]; // documented; absent key disables the source
  rateLimit: { requests: number; perSeconds: number };
  capabilities: Array<"spot" | "historical" | "series" | "fx">;
  fetch(req: FetchRequest, ctx: FetchContext): Promise<FetchResult>;
}

export interface FetchResult {
  points: Array<{
    ref: string; // asset identifier or series id
    date: string; // ISO 8601 date
    value: string; // DECIMAL STRING — never a JS number
    currency: CurrencyCode | null;
    tenorDays?: number; // required for yield_curve; absent for scalar data
  }>;
  warnings: string[];
}
```

Three rules that make third-party adapters safe to merge:

1. **Adapters must use `ctx.http`, never global `fetch`.** `ctx.http` applies the
   declared rate limit, retries with backoff, sets a project user-agent, and —
   critically — records and replays HTTP fixtures. A lint rule bans `fetch` and
   `axios` inside `packs/`.
2. **Values cross the boundary as normalized strings.** ARCHITECTURE §4.4 says
   money is decimal; the pack boundary is exactly where a careless `parseFloat`
   would enter. Rates use unit form (`"0.12"` = 12%), not an upstream source's
   percentage-point form. The type system prevents float conversion; fixtures
   prove the semantic unit.
3. **`license` is mandatory and reviewed.** You are asking self-hosters to run
   this code. An adapter scraping a source that forbids it is a liability for
   every deployment, not just the contributor's.

Sources that need an API key stay optional: if the env var is absent, the source
is disabled, instruments depending on it show as unpriced with a clear reason,
and nothing crashes. A self-hoster in Brazil should never need a UK API key.

---

## 8. FX resolution

The kernel must convert every native currency to the user's base currency on
every valuation date.

- Packs register direct FX series where an authoritative one exists (BCB PTAX
  for USDBRL, BoE for GBPUSD).
- For pairs with no direct series, the kernel **triangulates through USD** and
  marks the result as derived.
- Missing observations are carried forward with a maximum staleness equal to the
  longest holiday run in the relevant calendar, plus one day. Beyond that the
  valuation is **flagged, not silently estimated** — the UI shows the position as
  stale rather than printing a confident wrong number.
- Price date and FX date must match. Where two markets' calendars do not overlap,
  both are carried forward under the same rule and the snapshot records that it
  was built on carried-forward inputs.

Known edge case, explicitly out of scope for API v1: instruments quoted in the
local currency but economically exposed to another (Brazilian BDRs, currency-
hedged ETFs). Their FX attribution is not a currency conversion and the naive
decomposition will report zero FX contribution, which is wrong. Document per
instrument kind; solve after two packs need it.

---

## 9. Calendars

```ts
export interface MarketCalendar {
  timezone: string; // IANA
  weekend: number[]; // [0, 6]
  holidays(year: number): string[]; // ISO dates
  settlement: "T+0" | "T+1" | "T+2";
}
```

Required for `BUS/252` day counts, staleness windows, and deciding whether a
missing price is a holiday or an ingestion failure. Holidays as a function rather
than a static list so packs can encode moving feasts without shipping a
dependency.

---

## 10. Registry and loading

```ts
// packs/index.ts — checked in, one line per pack
import { brPack } from "./br";
import { ukPack } from "./uk";

export const PACKS = [brPack, ukPack] as const;
```

Static imports, resolved at build time. At runtime the app activates only the
packs listed in `user_settings.enabled_packs`; the rest contribute manifest
bytes and nothing else. Cron jobs iterate enabled packs' sources.

Because this project deliberately ships two cron jobs (`ARCHITECTURE.md` §3) — an
atomicity, rate-limit and resume choice, not a platform cap — the price
job must iterate sources within a single invocation with a per-source time
budget and resume markers, not one job per pack. Design this in Milestone 1 —
it is the constraint most likely to be discovered painfully later.

---

## 11. Conformance suite

`pnpm test:packs` is the gate. A pack PR merges when all of these pass.

1. **Manifest validity** — parses against the kernel zod schema; `apiVersion`
   matches; all ids prefixed with the pack id; no collisions with other packs.
2. **Referential integrity** — every `sourceId` and `seriesId` referenced by an
   instrument or series resolves within the pack or a declared dependency.
3. **Fixture coverage** — every source has recorded fixtures for: success, empty
   result, upstream 5xx, and 429. Adapters replay offline and deterministically.
4. **Output contract** — property tests over fixtures: values parse as decimals,
   no NaN, no floats, dates are ISO and not in the future, currency is declared
   ISO 4217.
5. **Golden portfolio** — the pack ships `fixtures/portfolio.json`: a small set
   of transactions across its instrument kinds, plus hand-computed expected
   valuation, TWR and MWR in `fixtures/expected.json`. Kernel output must match
   to 1e-8. **This is the real gate.** It proves the mapping onto kernel
   strategies is correct, which no type check can.
6. **Licence check** — `license` matches the allowlist in `packs/LICENSES.md`.
7. **Dependency check** — the pack introduces no npm dependency and imports
   nothing from `lib/calc/` internals.
8. **Docs** — `packs/<id>/README.md` exists with a coverage table, source list,
   and a "quirks" section.

Requirement 5 is also the honest answer to "how do I trust a contributor's
numbers". You do not review their arithmetic. You require them to state expected
values independently and let CI prove the kernel reproduces them.

---

## 12. Governance

**CODEOWNERS is generated** from each manifest's `maintainers` field by a script
in CI. Pack owners approve changes to their own directory. Changes to
`packs/types.ts`, `lib/calc/`, or any migration require your review.

**Pack lifecycle:**

| Status         | Meaning                                                               | Consequence                                                                         |
| -------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `draft`        | Incomplete or unvalidated                                             | Tests run; never in default `enabled_packs`; UI banner; blocks `pnpm release:check` |
| `supported`    | ≥1 responsive maintainer, CI green, fixtures refreshed within 90 days | Fully offered                                                                       |
| `unmaintained` | CI red 30 days or maintainer unreachable                              | UI banner; removed after two releases                                               |

**API versioning:** `PACK_API_VERSION` is an integer. A breaking change bumps it,
and the same PR updates every in-repo pack. That is only possible because packs
live in this repo — it is the concrete payoff of the distribution decision.

**Scope discipline.** These stay kernel-only and are not accepted as pack
contributions: new valuation strategies, new series kinds, changes to
`lib/calc/`, migrations, npm dependencies, auth changes, and anything touching
tax or fiscal reporting (`ARCHITECTURE.md` §2 excludes it, and it multiplies
per-jurisdiction liability faster than any other feature).

---

## 13. Migrating the existing spec

Move out of `SPEC.md` into `packs/br`:

- The six ingestion sources → three `PriceSource` adapters
  (Tesouro Transparente, brapi.dev, BCB SGS) plus three that belong elsewhere.
- The benchmarks → `SeriesDescriptor`s with the `benchmark` role (five in `br`,
  USDBRL in `global`).
- TD, CDB/LCI, FII definitions → `InstrumentKind`s.
- BUS/252 conventions, B3 holidays → `MarketCalendar`.

Goes into a new `packs/global`:

- CoinGecko (crypto is not a national market), AwesomeAPI and PTAX as `fx`
  sources, Yahoo Finance as a multi-market `market_price` source.
  _AwesomeAPI deferred 2026-09-06: no series consumes it. See `MILESTONES.md`
  Milestone 1 decisions._

Goes into `packs/us`:

- US-listed equities and ETFs, NYSE/Nasdaq calendar, S&P 500 as a series.

Stays in `SPEC.md` unchanged: schema core, calculation formulas and their
citations, the ten screens, the design system, Recharts configuration.

---

## 14. Effect on `MILESTONES.md`

Two changes, both prescriptive:

**Build `packs/br` as a pack from the first commit.** Do not build Brazil
directly into the kernel and extract it later. Extraction always leaks: the
assumptions you fail to notice are exactly the ones that make the second pack
painful.

**Write a minimal `packs/uk` yourself before v1.0** — one instrument kind (a
gilt), one series (SONIA), one source. It will be incomplete and that is fine.
An abstraction validated by one implementation is not validated. This canary
pack is what turns the design above from plausible to proven, and it is far
cheaper for you to discover the flaws than for your first outside contributor
to.

Suggested insertion: the kernel and `packs/br` share Milestones 1–3 as
specified; the canary `packs/uk` and the conformance suite become Milestone 4,
ahead of any polish work.

_Re-sequenced 2026-09-20 (`MILESTONES.md` §4 decision 32): the conformance
suite shipped with Milestone 1; the canary is Milestone 5, after Brazil
reaches production. The reason above is preserved by §16 and the
neutrality test, not by the order._

---

## 15. Open questions

- Base currency change after transactions exist: recompute history, or lock at
  first transaction? Recommend locking for v1 with an explicit reset path.
- Cross-pack asset identity (the same ETF listed in two markets) — deferred with
  the public asset catalog decision already deferred in `SPEC.md` §2.
- ~~UI string translation~~ — closed by `MILESTONES.md` §4 decision 34: UI
  copy is kernel-owned. `lib/copy/<locale>.ts` dictionaries share one `Copy`
  type and are selected by `user_settings.locale`; English and Brazilian
  Portuguese ship first. A pack's `locale` field drives number and date
  formatting only. A new language is a new dictionary file, contributed like
  a pack but reviewed as kernel.

---

## 16. What the second pack will meet

The assumptions Milestones 2–4 made while only Brazil existed, each with the
decision that made it. Milestone 5's UK canary ticks every line against its
own independently derived golden fixture; a line that cannot be ticked is a
kernel change with a `PACK_API_VERSION` bump, not a pack workaround (§1).

- Cash flows are entered in the base currency only (`MILESTONES.md` §3
  decision 25); the kernel already converts a non-base flow at its date.
- FX resolves direct, inverted, or through a USD pivot from one `fx_rate`
  series per pair (`lib/calc/fx.ts`); a second FX series (GBP/USD, hence
  GBP/BRL by triangulation) has never been exercised.
- The snapshot calendar is the union of the holdable packs' business days
  (§3 decision 21); two national calendars have never been unioned.
- The Maturities convention: `maturity: IsoDate` in `metadataSchema` (§4
  decision 38) — a gilt must carry it.
- `curve_mark_to_market` is implemented for nominal bonds only; `indexation`
  returns `unpriced` with `indexation_not_supported` (§2 decision 7). A
  linker needs an index base date the §5 shape does not carry.
- Rate series have only been exercised on `BUS/252` daily compounding (§2
  decisions 9, 13); SONIA on `ACT/365` exercises `rate_daily` with a
  different day count and `compoundRate`'s `ACT/365` branch.
- Staleness windows come from `stalenessWindowDays` over the pack calendar
  (the longest closure run + 1); a calendar with a different closure
  pattern (UK bank holidays) yields its own window.
- **The "two calendars per pack" question**: B3 does not trade on 24 and
  31 December while CDI is still published, so `packs/br` uses the ANBIMA
  calendar and a missing FII quote on those days looks like an ingestion
  failure (`packs/br/README.md` Quirks). The LSE-vs-bank-holiday split is
  the same question. Whether `MarketCalendar` becomes two calendars (trading
  and settlement/publication) is a `PACK_API_VERSION` question the canary
  answers with evidence.
- Nothing in `app/` or `lib/` names a pack, a currency or a locale outside
  `lib/settings/defaults.ts` (and locale literals in `lib/copy/index.ts`);
  `packs/conformance/kernel-neutrality.test.ts` enforces it (§4 decision
  42). That test is the proof that nothing else was assumed.

Milestone 5 ticks each item with the UK golden fixture.
