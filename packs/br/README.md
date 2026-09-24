# packs/br — Brazil

Status: **supported**. Maintainers: @mateuscury.

## Coverage

| Instrument kind     | Valuation strategy                                | Source               | Notes                                                                                                                                                                         |
| ------------------- | ------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `br.tesouro_direto` | `nav_unit_price`                                  | Tesouro Transparente | `custom` identifier `td:<slug>:<maturity>`; metadata is `titulo` + `maturity` (+ optional display `purchaseRate`)                                                             |
| `br.cdb`            | `accrual` BUS/252 daily, `percent_of_index` CDI   | — (series only)      | rate stored in metadata                                                                                                                                                       |
| `br.lci_lca`        | `accrual` BUS/252 daily, `percent_of_index` CDI   | — (series only)      | tax exemption is out of scope (no fiscal reporting)                                                                                                                           |
| `br.cdb_prefixado`  | `accrual` BUS/252 daily, plain                    | — (series only)      | `rate` is the effective annual rate ("0.12" = 12% a.a.)                                                                                                                       |
| `br.cdb_ipca`       | `accrual` BUS/252 daily, `index_plus_spread` IPCA | — (series only)      | `rate` is the spread over the índice; level ratio from `br.ipca`                                                                                                              |
| `br.fii`            | `market_price`                                    | brapi.dev            | ticker-identified                                                                                                                                                             |
| `br.stock`          | `market_price`                                    | brapi.dev            | ações, ETFs and BDRs on B3, ticker-identified; metadata `{ name }`. A BDR is quoted in BRL over a foreign underlying, so FX attribution reports 0 for it (SPEC §11 known gap) |

## Series

| Id            | Kind                          | Roles                              | Source     | Upstream ref              |
| ------------- | ----------------------------- | ---------------------------------- | ---------- | ------------------------- |
| `br.cdi`      | rate_daily BUS/252            | benchmark, accrual_index           | BCB SGS    | 12                        |
| `br.selic`    | rate_daily BUS/252            | benchmark, accrual_index           | BCB SGS    | 11                        |
| `br.ipca`     | inflation_index, linear_daily | benchmark, deflator, accrual_index | IBGE SIDRA | table 1737, variable 2266 |
| `br.ibovespa` | index_level                   | benchmark                          | brapi.dev  | `^BVSP`                   |
| `br.ifix`     | index_level                   | benchmark                          | brapi.dev  | `IFIX.SA`                 |

## Sources

| Id                        | Licence             | Auth    | Env           | Adapter                                                      |
| ------------------------- | ------------------- | ------- | ------------- | ------------------------------------------------------------ |
| `br.bcb_sgs`              | public-domain       | none    | —             | implemented — CDI/SELIC; SGS 433 (IPCA) deliberately refused |
| `br.ibge_sidra`           | public-domain       | none    | —             | implemented — IPCA número-índice                             |
| `br.brapi`                | api-terms:free-tier | api_key | `BRAPI_TOKEN` | implemented — FII and equity spot/historical, index series   |
| `br.tesouro_transparente` | **odbl-1.0**        | none    | —             | implemented — `PU Base Manha`                                |

### Attribution

`br.tesouro_transparente` uses the [Taxas dos Títulos Ofertados pelo Tesouro
Direto](https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto)
dataset, published by the Tesouro Nacional under the **Open Database License
(ODbL) 1.0**. Attribution is a licence condition and must be retained by any
deployment that redistributes this data.

## Quirks

- **Calendar is ANBIMA/national, not B3 trading.** B3 does not trade on 24 and
  31 December but CDI is still published, so those days are _not_ holidays here.
  Consequence: a missing FII quote on those two days will look like an
  ingestion failure. Track under the "two calendars per pack" kernel question.
- **BCB rate units are percentage points.** The adapter divides CDI/SELIC by
  100 using decimal-string operations (`0.045513` → `0.00045513`); it never
  converts money or rates through a JS number.
- **`br.ipca` comes from IBGE SIDRA, not BCB SGS 433.** SGS 433 is a monthly
  percentage _change_; the kernel's `inflation_index` needs a _level_, and
  chaining one into the other is arithmetic — which packs never supply
  (PACKS.md §1). SIDRA table 1737 variable 2266 publishes the número-índice
  (base December 1993 = 100) directly. The SGS adapter still refuses `br.ipca`
  explicitly, as a regression guard.
- **A monthly IPCA observation is dated the LAST CALENDAR DAY of its reference
  month.** `br.ipca` declares `interpolation: "linear_daily"`, so the kernel
  interpolates between consecutive month-end anchors; dating on the first of the
  month instead would shift every interpolated value by a month.
- **BCB SGS reports an empty window as HTTP 404**, with an
  `SGSNegocioException: Value(s) not found` body — not as `200 []`. That is
  "checked, nothing published" (a weekend or a pre-publication day) and the
  adapter certifies coverage for it. Treating it as an error would stall the
  CDI/SELIC watermark on every such run.
- **Tesouro Direto is valued from `PU Base Manha`, not from a curve.** Tesouro
  publishes one rate and one unit price per _bond_ per day, never per tenor, so
  a fixed-tenor `br.td_curve` would have meant interpolating inside a pack. The
  PU is what Tesouro itself marks against and what a broker statement shows.
  The rate locked at purchase may be stored as `purchaseRate` metadata for
  display, but it never values a holding: accruing at the contracted rate
  ("marcação na curva") is a different number, and would be a kernel `accrual`
  feature (MILESTONES.md decision 2).
- **Tesouro bonds have no ISIN in the published file.** They are identified by
  `Tipo Titulo` + `Data Vencimento`, so the pack mints a `custom` identifier
  `td:<slugified-title>:<YYYY-MM-DD>`, e.g.
  `td:tesouro-ipca-com-juros-semestrais:2035-05-15`. One exported, unit-tested
  function (`tesouroCanonicalId`) builds it, because asset creation, CSV import
  and ingestion must agree byte for byte or a holding silently stops pricing.
- **The Tesouro CSV is one ~14 MB file (~176,000 rows).** The adapter scans it
  by newline index and filters as rows are read, polling `ctx.signal`; it never
  splits the file into an array. An abort mid-parse emits NO points, because
  rows are newest-first and a half-read file is a truncated range for every bond.
- **brapi's free plan caps history at 3 months, and REJECTS rather than
  truncates.** `range=6mo` returns HTTP 400 with
  `limit.current: ["1d","5d","1mo","3mo"]`. The adapter therefore requests only
  an allowed range and reports anything older as uncovered, which the scheduler
  records as `unavailable_before`. Consequence: FII price history older than
  ~3 months cannot be backfilled automatically on this plan.
- **brapi silently ignores `start`/`end`.** Asking for 2026-01-01..2026-03-01
  returns HTTP 200 carrying the last month of data with `usedRange: "1mo"`.
  Trusting those parameters would file recent prices under January's dates, so
  the adapter sends only `range` and re-checks every returned bar against the
  requested window.
- **brapi index symbols are `^BVSP` and `IFIX.SA`** (not `IFIX`), served by the
  documented legacy `/api/quote/{symbol}` route. `/api/v2/tickers/coverage`
  reports `status: "unknown"` with every `availableData` flag false for both,
  even authenticated, so it is not authoritative for index symbols.
- **brapi daily bars are anchored at midnight São Paulo (03:00 UTC).** Dates are
  resolved in `America/Sao_Paulo`; a UTC-based date would agree today and start
  shifting the whole series by one day the moment a bar crossed 03:00.
- **Consciência Negra (20 Nov)** is a national holiday only from 2024
  (Lei 14.759/2023). Earlier years correctly omit it.
- Dependency on `global` for `global.usdbrl` (PTAX). BDRs are quoted in BRL but
  economically USD-exposed; their FX attribution is wrong under v1 (PACKS.md §8)
  and they are deliberately not an instrument kind yet.
