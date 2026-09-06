# Data licence allowlist

`PriceSource.license` must match one of the identifiers below exactly
(PACKS.md §7 rule 3, §11.6). Self-hosters run every adapter in this repo, so a
source whose terms forbid programmatic access is a liability for every
deployment, not just the contributor's.

To add a licence: open a kernel PR with a link to the source's terms and a
one-paragraph justification. Maintainer review required.

| Identifier | Meaning | Typical sources |
|---|---|---|
| `public-domain` | Government / central-bank open data with no reuse restriction | BCB SGS, Tesouro Transparente (Dados Abertos) |
| `odbl-1.0` | Open Database License 1.0 | — |
| `cc-by-4.0` | Creative Commons Attribution 4.0 | — |
| `api-terms:free-tier` | Vendor API whose published terms permit personal/non-commercial use on a free tier with an API key | brapi.dev, CoinGecko |
| `api-terms:public` | Vendor API whose published terms permit unauthenticated programmatic access | AwesomeAPI |

Not allowed: scraping HTML from sites whose terms forbid it, redistributing
vendor feeds licensed to an individual, or any source with no discoverable terms.
