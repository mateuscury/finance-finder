# packs/global

Status: **draft**. Maintainers: @mateuscury.

Sources and series that belong to no single national market (PACKS.md §13).

## Coverage

| Instrument kind | Valuation strategy | Source | Notes |
|---|---|---|---|
| — | — | — | Crypto (`market_price` via CoinGecko) and Yahoo Finance multi-market quotes are planned; not yet declared. |

## Series

| Id | Kind | Roles | Source |
|---|---|---|---|
| `global.usdbrl` | fx_rate USD→BRL | fx, benchmark | BCB PTAX |

## Sources

| Id | Licence | Auth | Env | Adapter |
|---|---|---|---|---|
| `global.bcb_ptax` | public-domain | none | — | **stub** |
| `global.awesomeapi` | api-terms:public | none | — | **stub** |

## Quirks

- The pack id `global` is the single exception to the "ISO alpha-2 pack id"
  rule; the manifest schema allows it explicitly.
- The calendar has no weekend and no holidays. FX staleness is judged by the
  kernel against the consuming market's calendar, not this one (PACKS.md §8).
- Pairs with no direct series are triangulated through USD by the kernel and
  marked as derived. Only register a pair here when an authoritative fixing
  exists (PTAX for USDBRL, BoE for GBPUSD).
