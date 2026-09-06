# packs/br — Brazil

Status: **draft**. Maintainers: @mateuscury.

## Coverage

| Instrument kind | Valuation strategy | Source | Notes |
|---|---|---|---|
| `br.tesouro_direto` | `curve_mark_to_market` on `br.td_curve` | Tesouro Transparente | metadata extends the kernel curve shape with `titulo` |
| `br.cdb` | `accrual` BUS/252 daily, `percent_of_index` CDI | — (series only) | rate stored in metadata |
| `br.lci_lca` | `accrual` BUS/252 daily, `percent_of_index` CDI | — (series only) | tax exemption is out of scope (no fiscal reporting) |
| `br.fii` | `market_price` | brapi.dev | ticker-identified |

## Series

| Id | Kind | Roles | Source | Upstream ref |
|---|---|---|---|---|
| `br.cdi` | rate_daily BUS/252 | benchmark, accrual_index | BCB SGS | 12 |
| `br.selic` | rate_daily BUS/252 | benchmark, accrual_index | BCB SGS | 11 |
| `br.ipca` | inflation_index, linear_daily | benchmark, deflator, accrual_index | BCB SGS | 433 |
| `br.ibovespa` | index_level | benchmark | brapi.dev | ^BVSP |
| `br.ifix` | index_level | benchmark | brapi.dev | IFIX |
| `br.td_curve` | yield_curve (BUS/252 tenors) | discount_curve | Tesouro Transparente | daily rates CSV |

## Sources

| Id | Licence | Auth | Env | Adapter |
|---|---|---|---|---|
| `br.bcb_sgs` | public-domain | none | — | implemented |
| `br.brapi` | api-terms:free-tier | api_key | `BRAPI_TOKEN` | **stub** |
| `br.tesouro_transparente` | public-domain | none | — | **stub** |

## Quirks

- **Calendar is ANBIMA/national, not B3 trading.** B3 does not trade on 24 and
  31 December but CDI is still published, so those days are *not* holidays here.
  Consequence: a missing FII quote on those two days will look like an
  ingestion failure. Track under the "two calendars per pack" kernel question.
- **`br.ipca` upstream is a monthly % variation (SGS 433), not an index level.**
  The kernel's `inflation_index` expects a level. The adapter must chain the
  variations into a level (base 100 at series start) before returning points.
  Not yet done — pack stays draft until it is.
- **`br.td_curve` is Tesouro's own reference rates**, not the DI futures curve
  from B3. It is the curve Tesouro Direto marks against, which is what the
  `curve_mark_to_market` strategy needs; do not "upgrade" it to DI futures
  without checking the golden portfolio.
- **Consciência Negra (20 Nov)** is a national holiday only from 2024
  (Lei 14.759/2023). Earlier years correctly omit it.
- Dependency on `global` for `global.usdbrl` (PTAX). BDRs are quoted in BRL but
  economically USD-exposed; their FX attribution is wrong under v1 (PACKS.md §8)
  and they are deliberately not an instrument kind yet.
