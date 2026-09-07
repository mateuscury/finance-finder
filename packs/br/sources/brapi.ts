/**
 * brapi.dev — B3 quotes (FIIs, equities, indices). Requires a free API key.
 * https://brapi.dev/docs
 *
 * CONTRACT, verified live against this project's FREE token on 2026-09-06.
 * Every choice below is evidence, not documentation-reading:
 *
 * 1. ENDPOINT: the legacy `/api/quote/{symbol}` route. It serves FII and equity
 *    quotes AND both index symbols on the free plan. `/api/v2/tickers/coverage`
 *    was consulted as the plan requires, but it reports `status: "unknown"`
 *    with every `availableData` flag false for `^BVSP` and `IFIX.SA` even when
 *    authenticated, and recommends only `search`/`renames` — it is simply not
 *    authoritative for index symbols. So the documented legacy path that
 *    demonstrably works is pinned, rather than a v2 path guessed from it.
 *
 * 2. SYMBOLS: `br.ibovespa` -> `^BVSP`, `br.ifix` -> `IFIX.SA` (not `IFIX`).
 *    Both were exercised for quote and historical under the real token.
 *
 * 3. HISTORY IS CAPPED AT 3 MONTHS on the free plan, and the cap REJECTS
 *    rather than truncates: `range=6mo` returns HTTP 400 with
 *    `limit.current: ["1d","5d","1mo","3mo"]`. So this adapter only ever asks
 *    for a range it is allowed to ask for, and reports anything older as
 *    uncovered instead of silently returning a short history.
 *
 * 4. `start`/`end` MUST NOT BE USED. They are accepted with HTTP 200 and then
 *    SILENTLY IGNORED: asking for 2026-01-01..2026-03-01 returned
 *    2026-08-07..2026-09-04 with `usedRange: "1mo"`. Trusting them would file
 *    recent prices under January's dates — a silent corruption, not an error.
 *    Only `range` is sent, and every returned bar is re-checked against the
 *    requested window.
 *
 * 5. Symbols are requested ONE AT A TIME: a comma-separated list returns zero
 *    results on the free plan.
 *
 * 6. Prices are read as TEXT LEXEMES via packs/json-lexemes.ts. `JSON.parse`
 *    would turn `148.3` into a double before this code ever saw it.
 */
import { coverageFor } from "../../coverage";
import { plainDecimal } from "../../decimal-text";
import { asArray, asObject, asString, parseJsonPreservingNumbers, rawNumber, safeInteger } from "../../json-lexemes";
import type { FetchContext, FetchRequest, FetchResult, PriceSource } from "../../types";

const API = "https://brapi.dev/api/quote";
const TOKEN_VAR = "BRAPI_TOKEN";
const QUOTE_CURRENCY = "BRL";

/** Index series this source serves, and the exact upstream symbol for each. */
const SERIES_SYMBOLS: Record<string, string> = {
  "br.ibovespa": "^BVSP",
  "br.ifix": "IFIX.SA",
};

/**
 * Ranges the FREE plan accepts, smallest first, with how far back each reaches.
 * Verified 2026-09-06; `6mo` and beyond are HTTP 400 on this plan. If the
 * project's plan changes, extend this list — do not remove the cap handling,
 * because the boundary simply moves.
 */
const SUPPORTED_RANGES = [
  { range: "1d", days: 1 },
  { range: "5d", days: 5 },
  { range: "1mo", days: 31 },
  { range: "3mo", days: 93 },
] as const;

const MAX_RANGE = SUPPORTED_RANGES[SUPPORTED_RANGES.length - 1];

/**
 * B3 observation date for a Unix timestamp, in America/Sao_Paulo.
 *
 * brapi anchors daily bars at midnight São Paulo (03:00 UTC), so a naive
 * `toISOString().slice(0,10)` happens to agree today — and would start
 * disagreeing the moment a bar crossed 03:00 UTC, silently shifting a whole
 * series by one day. The zone is therefore explicit. `en-CA` formats as
 * YYYY-MM-DD.
 */
const SAO_PAULO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toSaoPauloDate(epochMs: number): string | null {
  if (!Number.isFinite(epochMs)) return null;
  const formatted = SAO_PAULO.format(new Date(epochMs));
  return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : null;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/**
 * Smallest allowed range that reaches back to `from`, plus whether the plan
 * cap leaves part of the request unreachable. `range` is anchored at NOW, not
 * at the requested `to`, which is why the span is measured against today.
 */
export function chooseRange(fromIso: string, todayIso: string): { range: string; truncated: boolean } {
  const needed = daysBetween(fromIso, todayIso);
  for (const candidate of SUPPORTED_RANGES) {
    if (needed <= candidate.days) return { range: candidate.range, truncated: false };
  }
  return { range: MAX_RANGE.range, truncated: true };
}

/** Index series carry no currency; a tradable holding carries the quote currency. */
function currencyFor(ref: string): string | null {
  return ref in SERIES_SYMBOLS ? null : QUOTE_CURRENCY;
}

export async function fetchBrapi(req: FetchRequest, ctx: FetchContext): Promise<FetchResult> {
  const points: FetchResult["points"] = [];
  const warnings: string[] = [];
  const isSpot = req.capability === "spot";
  const today = toSaoPauloDate(ctx.now().getTime()) ?? ctx.now().toISOString().slice(0, 10);
  const from = req.from ?? today;
  const to = req.to ?? today;
  const covered = new Set<string>();
  /**
   * Oldest observation the upstream actually served for a ref, BEFORE the
   * requested window is applied. When the plan cap truncates the request this
   * is the structural floor, and it must be reported even though it usually
   * lies outside the requested window — that is exactly the case where no
   * points come back and the scheduler would otherwise loop (plan §3.2).
   */
  const availabilityFloor = new Map<string, string>();
  const emit = (): FetchResult =>
    isSpot
      ? { points, warnings }
      : {
          points,
          warnings,
          coverage: coverageFor(
            req.refs,
            { from, to },
            points,
            (r) => covered.has(r),
            (r) => availabilityFloor.get(r) ?? null,
          ),
        };

  if (!isSpot && req.capability !== "historical" && req.capability !== "series") {
    warnings.push(`brapi: unsupported capability '${req.capability}'`);
    return emit();
  }

  const token = ctx.env[TOKEN_VAR];
  if (!token) {
    // A missing key disables the source; it never crashes and never requests
    // (PACKS.md §7). The variable is named so the operator can act on it.
    warnings.push(`brapi: ${TOKEN_VAR} is not set; source disabled`);
    return emit();
  }

  const { range, truncated } = chooseRange(from, today);

  for (const ref of req.refs) {
    if (ctx.signal.aborted) {
      warnings.push("brapi: time budget exhausted before every ref was fetched");
      break;
    }
    const symbol = SERIES_SYMBOLS[ref] ?? ref;
    // Only `range` is ever sent. See contract note 4: start/end are ignored.
    const url = isSpot
      ? `${API}/${encodeURIComponent(symbol)}`
      : `${API}/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;

    let res;
    try {
      res = await ctx.http.get(url, {
        // The token travels in a header, never in the query string, so it
        // cannot leak through a URL in a log or a recorded fixture.
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
    } catch {
      warnings.push(`brapi: request failed for '${ref}'`);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      warnings.push(`brapi: ${TOKEN_VAR} was rejected (HTTP ${res.status})`);
      continue;
    }
    if (res.status === 400) {
      warnings.push(`brapi: '${range}' exceeds the current plan's history limit for '${ref}'`);
      continue;
    }
    if (res.status !== 200) {
      warnings.push(`brapi: HTTP ${res.status} for '${ref}'`);
      continue;
    }

    let body;
    try {
      body = parseJsonPreservingNumbers(await res.text());
    } catch {
      warnings.push(`brapi: unparsable payload for '${ref}'`);
      continue;
    }
    const results = asArray(asObject(body)?.results);
    const first = results && results.length > 0 ? asObject(results[0]) : null;
    if (!first) {
      warnings.push(`brapi: no results for '${ref}'`);
      continue;
    }
    // Guard against a mismatched echo: a symbol rename would otherwise file one
    // instrument's prices under another's identifier.
    const echoed = asString(first.symbol);
    if (echoed !== null && echoed !== symbol) {
      warnings.push(`brapi: upstream answered a different symbol for '${ref}'`);
      continue;
    }
    const currency = currencyFor(ref);

    if (isSpot) {
      const value = plainDecimal(rawNumber(first.regularMarketPrice) ?? "");
      const stamped = asString(first.regularMarketTime);
      const date = stamped ? toSaoPauloDate(Date.parse(stamped)) : today;
      if (value === null || value === "0" || date === null) {
        warnings.push(`brapi: no usable spot price for '${ref}'`);
        continue;
      }
      // Never date a point in the future relative to the run's clock.
      points.push({ ref, date: date > today ? today : date, value, currency });
      continue;
    }

    const bars = asArray(first.historicalDataPrice);
    if (!bars) {
      warnings.push(`brapi: no historical series for '${ref}'`);
      continue;
    }
    let rejected = 0;
    let oldestServed: string | null = null;
    const byDate = new Map<string, string>();
    for (const bar of bars) {
      const row = asObject(bar);
      const seconds = row ? safeInteger(row.date) : null;
      const date = seconds === null ? null : toSaoPauloDate(seconds * 1000);
      // The ACTUAL close. `adjustedClose` is a synthetic total-return figure;
      // `prices` stores the quote a holding could be marked at (plan §1.4).
      const value = row ? plainDecimal(rawNumber(row.close) ?? "") : null;
      if (date === null || value === null || value === "0") {
        rejected++;
        continue;
      }
      // Note the floor BEFORE the window filter: on a truncated request every
      // bar is usually outside the window, and the oldest of them is precisely
      // the boundary the scheduler needs.
      if (oldestServed === null || date < oldestServed) oldestServed = date;
      // brapi ignores date parameters, so the window is enforced HERE.
      if (date < from || date > to || date > today) continue;
      byDate.set(date, value);
    }
    if (rejected > 0) warnings.push(`brapi: skipped ${rejected} unusable bar(s) for '${ref}'`);

    for (const date of [...byDate.keys()].sort()) {
      points.push({ ref, date, value: byDate.get(date)!, currency });
    }
    if (truncated) {
      // Honest: the plan cap means the older part of this window is not merely
      // absent, it is unreachable. Declaring the floor EXPLICITLY is what lets
      // the scheduler skip forward to it. Reporting only "incomplete, nothing
      // returned" would make an FII bought more than three months ago
      // re-request the same unreachable chunk on every run, forever.
      if (oldestServed !== null) availabilityFloor.set(ref, oldestServed);
      warnings.push(`brapi: history before the plan's ${MAX_RANGE.range} limit is unavailable for '${ref}'`);
    } else {
      covered.add(ref);
    }
  }
  return emit();
}

export const brapiSource: PriceSource = {
  id: "br.brapi",
  label: "brapi.dev",
  homepage: "https://brapi.dev/",
  license: "api-terms:free-tier",
  auth: "api_key",
  envVars: [TOKEN_VAR],
  rateLimit: { requests: 1, perSeconds: 1 },
  capabilities: ["spot", "historical", "series"],
  fetch: fetchBrapi,
};
