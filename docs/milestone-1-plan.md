# Milestone 1 — Trusted ingestion: implementation plan

Revised 2026-09-06 from the tree and the upstream contracts available on that
date. `MILESTONES.md` §1 is the scope authority; its three recorded decisions
remain binding. This document defines the implementation and merge order. Every
merge unit must leave `pnpm test` green on `main`.

## Outcome

Milestone 1 ends with one resumable ingestion path that can run live, record
sanitized fixtures, replay entirely offline, validate every adapter point, and
write market data without replacing a user's manual price. It does **not** make
either pack supported or make the product safe for real portfolio data.

The final source inventory is exactly five adapters:

| Pack | Source | Consumers |
|---|---|---|
| `global` | `global.bcb_ptax` | `global.usdbrl` |
| `br` | `br.bcb_sgs` | `br.cdi`, `br.selic` |
| `br` | `br.ibge_sidra` | `br.ipca` |
| `br` | `br.brapi` | FII prices, `br.ibovespa`, `br.ifix` |
| `br` | `br.tesouro_transparente` | Tesouro Direto unit prices |

`global.awesomeapi` is removed. The source count stays at five because
`br.ibge_sidra` replaces it in the inventory.

## Upstream contracts locked for this milestone

These facts were rechecked while revising the plan. If a live contract test
disagrees, stop and amend the plan and pack docs before implementing around it.

- **IPCA:** use [IBGE SIDRA table 1737](https://sidra.ibge.gov.br/tabela/1737),
  variable `2266`, “IPCA — Número-índice (base: dezembro de 1993 = 100)”. This
  is already a level; the adapter performs no chaining or inflation math.
- **PTAX:** use the [BCB PTAX Olinda service](https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/documentacao),
  call `CotacaoDolarPeriodo`, filter bulletin
  `Fechamento`, and read `cotacaoVenda`. Request CSV so the decimal lexeme is
  preserved instead of first becoming a JavaScript number.
- **brapi:** prefer the versioned
  [`/api/v2/stocks/quote`](https://brapi.dev/docs/acoes/cotacao) and
  [`/api/v2/stocks/historical`](https://brapi.dev/docs/acoes/historico)
  endpoints where the public ticker-coverage endpoint recommends them, and pin
  that result in a contract test. The index symbols are `^BVSP` and `IFIX.SA`,
  not `IFIX`. [Basic FII quotes](https://brapi.dev/docs/fiis) remain available
  on every plan through the legacy `/api/quote/{ticker}` route, while the
  dedicated v2 FII historical endpoint requires Pro except for two sandbox symbols.
  Historical depth is plan-dependent and a request beyond the plan limit may be
  truncated rather than rejected; capability declarations must match what the
  project's free token actually serves.
- **Tesouro Direto:** the [official metadata](https://tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/1a8eb2e3-4902-4a38-a1eb-6410f23d90de/download/Taxa.pdf)
  defines `PU Base Manhã` as the D0 price used to mark acquired bonds to market.
  The file identifies a bond by `Tipo Titulo` plus `Data Vencimento`; it does
  not contain an ISIN. The [dataset](https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto)
  is licensed ODbL, so the manifest must use `odbl-1.0` and the pack README must
  retain attribution.
- **Hosting:** current [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
  allow a Hobby project up to 100 cron entries, each at most once per day.
  Keeping one price job is therefore a deliberate atomicity, rate-limit, and
  resume design—not a two-cron platform cap. [Function duration](https://vercel.com/docs/functions/configuring-functions/duration)
  is currently up to 300 seconds with Fluid compute and 60 seconds without it.
  Record the project's compute mode and configure an explicit route duration;
  never infer a budget from an old plan limit.

## Definition of done

- `PACK_API_VERSION` reflects the finalized Milestone 1 context contract, and
  every in-repo manifest and conformance test uses that version.
- `lib/packs/http.ts`, `lib/packs/validate.ts`, `lib/packs/activate.ts`, and
  `lib/packs/ingest.ts` exist. The release gate already requires all except
  `validate.ts`.
- None of the five registered `PriceSource.fetch` implementations is a stub or
  contains `not implemented`.
- Every source ships
  `fixtures/http/<source.id>/{success,empty,upstream_5xx,rate_limited_429}.json`.
  Each declared capability is exercised by a `success` and `empty` fixture
  case; error fixtures may use one representative capability.
- Fixture replay is deterministic, makes no network request, and checks both
  adapter output and HTTP retry behavior.
- `pnpm test:packs` reports **3 skipped tests**, down from 13. The remaining
  skips are the empty global golden-fixture case and the two Milestone 2 kernel
  reproduction cases.
- The final automated write and its cursor/watermark update are transactional,
  and an integration test proves an existing `source_id = 'manual'` price is
  never overwritten.
- Both packs remain `draft`. An authorized `GET /api/cron/prices` returns a
  redacted run summary rather than 501; an unauthorized request still fails
  before any database or network work.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.
- `pnpm release:check` remains red, but the direct readiness blocker list has no
  source stub, missing HTTP fixture, or missing Milestone 1 kernel file. Expected
  remaining blockers are the five `lib/calc` implementations, login, both draft
  packs, BR golden results, full JSON restore, and `specs/` placeholders.

## Non-goals

- Do not mark a pack `supported`.
- Do not implement financial calculations or fill golden expected results.
- Do not build the asset-creation, Refresh, login, or settings UI. Milestone 1
  only gives their later server actions a reusable scoped ingestion API.
- Do not implement JSON restore or snapshots.
- Do not add CoinGecko, Yahoo, AwesomeAPI, another pack, or another series.

## Ordering constraint

`packs/conformance/fixtures.test.ts` currently skips ten source tests while
`lib/packs/http.ts` is absent. The moment that path exists, all ten unskip and
one currently calls `expect.fail("not implemented")`. Therefore:

1. finalize the pack/context contract without creating `lib/packs/http.ts`;
2. land every adapter and manifest change against the interface;
3. add `http.ts`, the complete fixture set, fixture schemas, and real replay
   assertions in the same merge unit;
4. add activation, persistence, and the route only after replay is green.

Never create a placeholder `http.ts`, and never add another skip to hide the
temporary red state.

## Phase 0 — Close contracts before adapter work

### 0.1 Make source budgets enforceable

The existing `FetchContext` cannot cancel a slow request or a large synchronous
parse. Add a required `signal: AbortSignal` and `remainingMs(): number`; bind
`ctx.http` to the same signal. Adapters must check the signal inside long parse
loops. Extend `FetchResult` with structured coverage metadata for bounded
requests: requested interval, returned interval when any, and `complete`. That
is how an empty result can mean “successfully checked” and a plan-truncated
result can mean “known incomplete” without parsing warning prose. Remove the
free-form `ctx.log(message)` hook: adapters already return warnings, while the
runtime owns structured logs and HTTP telemetry. These are breaking pack API
changes, so bump `PACK_API_VERSION` and update both draft packs in the same
merge unit.

Tests must prove an aborted HTTP request and an aborted Tesouro parse finish
without emitting partial points. Do not implement a budget with only
`Promise.race`; that returns early while the underlying work keeps running.

### 0.2 Fix resume granularity

`ingest_cursors.last_date` is one value for a source that can serve many refs and
capabilities. It cannot distinguish an already-backfilled ticker from a newly
created asset, and an empty but successful range would be requested forever.

Keep `ingest_cursors` for source-level scheduling and user-facing status, and
add kernel-owned `ingest_watermarks` keyed by
`(source_id, capability, ref)`, with `target_from`, `last_date`, and optional
`unavailable_before`. A new asset can require history earlier than a ref's
previous target; when that happens, reset the effective watermark to the earlier
`target_from` and replay forward idempotently. A watermark advances through the
requested `to` date only after that ref's request and validated write succeed; a
valid, coverage-complete empty result also advances it. A truncated source range
records its honest lower availability boundary in `unavailable_before` so the
scheduler neither calls the missing span ingested nor requests it every night.
Clear that boundary explicitly when source credentials or plan coverage change.
`ingest_cursors.last_date` becomes the minimum committed `last_date` for that
source, useful as a summary but not as the source of truth.

Before editing SQL, verify whether the initial migration has been applied to
any local, preview, or hosted database. If none has, edit the initial migration
as the repository currently intends. If any has, add a forward migration. Do
not rely on the phrase “still unapplied” in an implementation plan.

### 0.3 Record the deployment budget

Read the checked-in Next.js guide at
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`
before changing the route. Confirm Fluid compute in the deployed project, set an
explicit `maxDuration` supported by that mode, and reserve at least 10 seconds
for the final database commit and response. The ingest budget is
`maxDuration * 1000 - reserveMs` and is passed explicitly to `runIngest`.

Also queue corrections to the stale “two Hobby crons” wording in
`ARCHITECTURE.md`, `SPEC.md`, `PACKS.md`, `README.md`, `CLAUDE.md`, route
comments, and `lib/packs/README.md`. The application may still intentionally
ship exactly two schedules.

## Phase 1 — Adapters against the finalized interface

Each adapter merge unit includes hand-rolled context tests like the current
`bcb-sgs.test.ts`. No emitted value may pass through a JavaScript `number`.
Adapters must return only requested refs and dates inside the requested range.

### 1. Remove `global.awesomeapi`

Delete `packs/global/sources/awesomeapi.ts`, remove it from the global manifest,
and update the global README and current-state docs. Keep `api-terms:public` in
`packs/LICENSES.md`; it remains a valid licence class and an example of a source
that may return later with a consumer.

### 2. Implement `global.bcb_ptax`

- Call `CotacaoDolarPeriodo` with bounded dates and CSV output.
- Select only bulletin `Fechamento` and field `cotacaoVenda` for
  `global.usdbrl`; emit `currency: "BRL"`.
- Preserve the decimal text, normalize the observation date, and cover empty,
  malformed, duplicate-bulletin, non-200, and cancellation behavior.
- Retain `fx` and `historical` capabilities.

### 3. Add `br.ibge_sidra`

- Add an unauthenticated, `public-domain` source for table `1737`, variable
  `2266`, national level, and point `br.ipca` at it.
- Parse SIDRA's value field as localized decimal text without floating-point
  conversion. Reject placeholder/missing values instead of coercing them.
- Convert each `YYYYMM` period to the last calendar day of that month. Document
  this convention because `linear_daily` interpolation depends on it.
- Keep the explicit SGS 433 rejection and its unit test as a regression guard;
  it is no longer the registered source for `br.ipca`.

### 4. Implement `br.brapi`

- Authenticate with `Authorization: Bearer <BRAPI_TOKEN>`. A missing token makes
  no request and returns one warning naming `BRAPI_TOKEN`.
- Call `/api/v2/tickers/coverage` for both index symbols during the contract
  check. Prefer its recommended versioned quote/historical paths; if it points
  an index at a documented legacy path, pin that path instead of guessing. Use
  bounded dates and daily observations for both index `series`.
- Use the officially supported legacy `/api/quote/{ticker}` route for basic FII
  `spot` quotes on the free plan.
- Map `br.ibovespa` to `^BVSP` and `br.ifix` to `IFIX.SA`. Before merging,
  exercise quote and historical requests for both under the actual free token.
  If either IFIX path is unavailable, remove `br.ifix` and document the reduced
  coverage; do not substitute an unlicensed scrape.
- Exercise historical requests for an arbitrary, non-sandbox FII under the
  actual free token. Keep `historical` only if that works through a documented
  endpoint; otherwise drop the capability and document that Milestone 1 can
  fetch current FII prices but cannot backfill them automatically. Do not design
  against the Pro-only `/api/v2/fii/historical` sandbox behavior.
- Use `regularMarketPrice` for spot and the actual close for dated valuation.
  Do not silently substitute adjusted close: `prices` stores the quote that a
  holding could be marked at, not a synthetic return index.
- Read `res.text()` and extract required numeric lexemes with a small tested JSON
  tokenizer. Do not apply a blanket regular expression to JSON and do not
  `JSON.parse` a number before converting it back to a string.
- Convert upstream timestamps to the B3 observation date in
  `America/Sao_Paulo`. Test UTC-boundary cases and report truncated historical
  coverage when the returned window is shorter than the requested window.

### 5. Implement `br.tesouro_transparente`

- Change the source licence to `odbl-1.0` and add the dataset attribution to the
  pack README.
- Change `br.tesouro_direto` to `identifier: "custom"`. Its canonical identifier
  is `td:<normalized-title-type>:<YYYY-MM-DD maturity>`, for example
  `td:tesouro-ipca-com-juros-semestrais:2035-05-15`. The normalizer is one
  exported, unit-tested function shared by import/asset creation later.
- Replace the curve-only metadata schema with a NAV-appropriate schema that
  requires `titulo` and `maturity` and may carry the purchase-date rate as an
  optional decimal string for display. Coupon/indexation fields are not required
  by this valuation strategy.
- Parse the official semicolon CSV. Normalize Brazilian money text exactly
  (`1.234,56` → `1234.56`) and emit the `PU Base Manhã` field, not PU Compra,
  PU Venda, or a rate. Emit one BRL point per requested canonical identifier and
  `Data Base` date.
- Read the response text once and scan lines incrementally, checking
  `ctx.signal` and filtering requested `(Tipo Titulo, Data Vencimento)` pairs as
  rows are parsed. Do not build an in-memory object for the full file.
- Switch `br.tesouro_direto` to
  `{ kind: "nav_unit_price", sourceId: "br.tesouro_transparente" }`, remove
  `br.td_curve`, and remove the source's `series` capability.
- The purchase-date rate is metadata only and is never used to value a holding.

## Phase 2 — HTTP runtime, fixtures, and replay

Land this phase as one merge unit so the ten source tests never see a partial
implementation.

### 2.1 `lib/packs/http.ts`

Provide a factory bound to a source, deadline, environment allowlist, and one of
three modes:

- `live`: process-local token-bucket limiting from `source.rateLimit`, project
  user-agent, deadline-aware aborts, and at most three total attempts for 429
  and 5xx. Every retry consumes a rate-limit token. Honor both forms of
  `Retry-After`, but never sleep past the source or invocation deadline.
- `record`: identical to live, while collecting the sanitized ordered exchange
  sequence for the fixture writer.
- `replay`: consume the recorded sequence strictly, throw on an unmatched or
  extra request, never call global `fetch`, and use injected no-op sleep/clock
  controls so retry cases are instant and deterministic.

A token bucket in one serverless instance is not a distributed global limit;
document that boundary. The single scheduled ingest invocation makes it useful,
while an upstream 429 remains the final authority.

HTTP telemetry is structured data owned by the runtime: source id, attempt,
status, and duration only. Never log a URL, header, body, adapter warning, ref,
or point value. The route summary is built from this telemetry.

### 2.2 Fixture envelope

Use one unambiguous versioned object; an array cannot also carry a top-level
`recordedAt`:

```json
{
  "version": 1,
  "recordedAt": "2026-09-06T12:00:00.000Z",
  "cases": [
    {
      "input": {
        "capability": "series",
        "refs": ["br.cdi"],
        "from": "2026-09-01",
        "to": "2026-09-05"
      },
      "exchanges": [
        {
          "request": { "method": "GET", "url": "...", "headers": {} },
          "response": { "status": 200, "headers": {}, "body": "..." }
        }
      ]
    }
  ]
}
```

`success.json` and `empty.json` contain enough cases to cover every declared
capability. Synthetic 5xx and 429 fixtures contain all repeated exchanges needed
to exhaust the three-attempt policy. `recordedAt` supplies `ctx.now()` during
replay.

Fixture inputs are a checked-in catalog of public sample identifiers, never read
from a user's database. Store only request headers needed for matching. Replace
declared env values and their URL-encoded forms everywhere with
`<REDACTED:VAR_NAME>`; normalize `Authorization` to
`Bearer <REDACTED:VAR_NAME>`. Apply redaction before a byte reaches the fixture
object, an exception, or a diagnostic—not only before writing the file.

### 2.3 Recorder and conformance

Add `scripts/record-fixtures.ts` with explicit source/fixture selection. It may
use live networking only in `record` mode. Record success and empty cases from
the fixed catalog; synthesize retryable failures locally. Never wait for an
upstream failure and never overwrite every fixture as an implicit side effect.

Add a zod schema for the fixture envelope and replace the replay placeholder
with assertions that:

- each final point parses structurally and semantically through
  `lib/packs/validate.ts`;
- bounded success/empty cases return internally consistent structured coverage;
  only `complete: true` may certify an empty requested interval;
- `ref` was requested, date is in range and not after `recordedAt`, and primary
  keys `(ref, date, tenorDays ?? 0)` are unique within a result;
- FX currency equals its declared quote; scalar rates and indexes use `null`;
  asset prices use the instrument quote currency; positive-value kinds are
  positive; and `tenorDays` exists only for a declared yield-curve tenor;
- success and empty cases cover every declared capability;
- 5xx and 429 cases emit no points, expose a safe warning, and perform exactly
  the configured attempts without real sleeping;
- replay rejects a changed method, URL, order, or unused exchange; and
- fixtures contain no raw authorization value, suspicious token query, full
  unredacted secret, user-derived identifier, or unsupported envelope version.

Unit-test token refill, retry exhaustion, both `Retry-After` formats, aborts,
deadline clipping, response cloning, redaction (raw and encoded), and strict
replay independently from adapter conformance.

## Phase 3 — Activation, persistence, and route

### 3.1 Activation and database boundary

Add `@supabase/supabase-js` as a kernel dependency and create the service-role
client in kernel-only server code. Keep `runIngest` testable through a narrow
`IngestStore` interface rather than importing Supabase throughout the scheduler.

`lib/packs/activate.ts` has two layers:

- a pure resolver that takes the registry plus enabled ids, removes unknown ids
  with a warning, rejects cycles, and resolves dependencies transitively; and
- a paginated store query that reads every user's `enabled_packs`, unions the
  ids, and then calls the resolver.

Test empty settings, duplicate ids, unknown ids, `br → global`, a multi-hop
dependency, and a cycle. Paginate every PostgREST collection with `.range()`;
never assume the configured 1,000-row maximum is a total count.

### 3.2 One scheduler for every caller

Export one function:

```ts
runIngest({ scope, budgetMs, now, store, httpFactory, env }): Promise<IngestSummary>
```

Use a discriminated scope from day one: all enabled packs (cron), explicit asset
ids (asset creation/import), all currently unpriced assets (Refresh), or series
for newly enabled packs. Only the cron scope is wired in Milestone 1; later
callers reuse the same authorization, validation, write, and budget path.

Build work items by `(source, capability, ref)` and batch only when one adapter
request has the same date window. Series refs come from activated manifests;
asset refs come from distinct identifiers for activated `market_price` or
`nav_unit_price` instruments. Retain the mapping from each distinct market ref
to every matching `asset_id`: one fetched FII quote may be written to the same
ticker held by several users, while each user's manual-price conflict is checked
independently. For each ref:

- target history starts at the earliest relevant transaction date; with no
  transaction, request only the current overlap window;
- if the computed target is earlier than `watermark.target_from`, restart that
  ref's forward cursor at the new target; otherwise resume at
  `watermark.last_date - overlap`, never before the target;
- cap each forward chunk and each adapter batch so initial backfill is resumable;
- use `historical` when a source declares it and `spot` for the latest point;
  explicitly report when the source cannot supply requested history; and
- advance the per-ref watermark through `to` after an explicitly
  coverage-complete empty response, but never after auth failure, abort,
  transport failure, or rejected output. For a truncated response, persist the
  returned points and `unavailable_before` boundary without describing the
  unavailable prefix as covered.

Order sources by `ingest_cursors.last_run_at nulls first`, then stable source id.
Give each source a child deadline. Do not start another source when the global
reserve would be consumed. Missing API-key env vars are preflight skips: no
adapter call, and `last_error` safely names the missing variable.

Validate the complete result before writing. A malformed point is counted and
rejected; it is never coerced. If any point makes the response ambiguous for a
ref—wrong ref, duplicate key, out-of-window date—do not advance that ref's
watermark.

### 3.3 Atomic, manual-safe writes

Expose one service-only `commit_ingest_chunk(jsonb)` RPC that, in one database
transaction:

1. upserts validated asset prices with
   `on conflict ... do update ... where prices.source_id <> 'manual'`;
2. upserts series points;
3. advances only the successful per-ref watermarks; and
4. updates the source cursor's run time, summary date, and safe error.

Use invoker security where possible, set an explicit `search_path`, revoke
function execution from `PUBLIC`, `anon`, and `authenticated`, and grant it only
to `service_role`. Return counts, including manual-price conflicts, never values.
Test rollback on a forced failure so data and watermarks cannot diverge.

### 3.4 Route and summary

`app/api/cron/prices/route.ts` must keep the existing authorization check as its
first operation, create the service-role dependencies only after it passes, and
call `runIngest` with the all-enabled scope and recorded deployment budget.

Return only:

- overall status and duration;
- per-source id, status (`ok`, `partial`, `skipped`, `error`, or
  `budget_exhausted`), HTTP status codes, attempts, duration;
- accepted, rejected, written, and manual-protected counts; and
- warning count plus a reviewed safe error code.

Never return or log a URL, ref, env value, warning string, response body, point,
quantity, or price. An authenticated run that completes with per-source failures
may return 200 with `ok: false`; reserve 500 for a fatal scheduler/configuration
failure. Vercel does not retry failed cron invocations, so resumability lives in
the database rather than the response code.

## Phase 4 — Documentation and gates

- Update BR/global source tables, Tesouro identifier/metadata/ODbL attribution,
  IPCA dating, brapi symbols/depth, and the single-job rationale.
- Rewrite `lib/packs/README.md` from “planned” to the actual runtime, fixture
  envelope, retry policy, cursor/watermark split, and logging boundary.
- Update `PACKS.md`, `SPEC.md`, `ARCHITECTURE.md`, `README.md`, `CLAUDE.md`, and
  route comments to remove the obsolete two-cron limit while retaining the
  intentional two-schedule architecture.
- Add `BRAPI_TOKEN` and any service-role/runtime variables to `.env.example`;
  fixture recording must not require production user data.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm codeowners --check`.
- Run `pnpm exec tsx scripts/check-release-readiness.ts` directly and compare
  its complete blocker list with the Definition of done. Then run
  `pnpm release:check` and confirm it fails only for post-Milestone-1 work.

## Suggested merge sequence for a solo maintainer

1. Context cancellation/logging contract, API version, and cursor granularity.
2. AwesomeAPI removal.
3. PTAX.
4. SIDRA/IPCA.
5. brapi, after its live coverage check.
6. Tesouro, including identifier, metadata, valuation, and licence corrections.
7. HTTP runtime + all fixtures + recorder + real replay conformance.
8. Activation + store + atomic RPC + scheduler.
9. Cron route + documentation + final gates.

PTAX remains the smallest first adapter. Tesouro is last because its official
identity, licence, large-file parsing, and valuation-field choices cross the
most contracts. Phase 3 starts only after the local Supabase stack is available;
manual-price protection and cursor atomicity require real Postgres integration
tests, not mocks alone.
