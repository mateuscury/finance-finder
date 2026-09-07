/**
 * packs/types.ts — KERNEL-OWNED.
 *
 * Packs import from this file and never edit it. Changing anything here is a
 * kernel change: it requires maintainer review, a PACK_API_VERSION bump when
 * breaking, and the same PR must update every in-repo pack (PACKS.md §12).
 *
 * The one rule (PACKS.md §1): packs supply data, identifiers and mappings.
 * Packs never supply math. Every union below is CLOSED — a pack that cannot be
 * expressed with these strategies is a signal about the kernel, not the pack.
 */

import type { ZodType } from "zod";

export const PACK_API_VERSION = 3 as const;

/** ISO 4217, upper-case, three letters. Validated by the manifest schema. */
export type CurrencyCode = string;

/**
 * A decimal number serialized as a string, e.g. "0.1065" or "1234.50".
 * Money and rates NEVER cross the pack boundary as JS numbers
 * (ARCHITECTURE §4.4, PACKS.md §7 rule 2).
 */
export type DecimalString = string;

/** ISO 8601 calendar date, "YYYY-MM-DD". */
export type IsoDate = string;

export type DayCount = "BUS/252" | "ACT/365" | "ACT/360" | "30/360";

// ---------------------------------------------------------------------------
// §5 Valuation strategies — closed set
// ---------------------------------------------------------------------------

export interface AccrualConvention {
  dayCount: DayCount;
  compounding: "daily" | "monthly" | "annual";
  index?:
    | { mode: "percent_of_index"; seriesId: string } // "110% do CDI"
    | { mode: "index_plus_spread"; seriesId: string }; // "IPCA + 6%"
}

export type ValuationStrategy =
  | { kind: "market_price"; sourceId: string }
  | { kind: "nav_unit_price"; sourceId: string }
  | { kind: "accrual"; convention: AccrualConvention }
  | { kind: "curve_mark_to_market"; seriesId: string };

export type ValuationStrategyKind = ValuationStrategy["kind"];

// ---------------------------------------------------------------------------
// §6 Series kinds — closed set
// ---------------------------------------------------------------------------

export type SeriesKind =
  /** `value` is a unit rate: "0.0005" means 0.05%, never 0.0005%. */
  | { kind: "rate_daily"; dayCount: DayCount }
  /** `value` is a unit rate: "0.12" means 12% per year. */
  | { kind: "rate_annual"; dayCount: DayCount }
  | { kind: "index_level" }
  /** `value` is an index level, not a periodic percentage change. */
  | { kind: "inflation_index"; interpolation: "none" | "linear_daily" }
  /** `value` is quote-currency units per one base-currency unit. */
  | { kind: "fx_rate"; base: CurrencyCode; quote: CurrencyCode }
  /** Each point carries one of these maturities in `tenorDays`. Rates are unit rates. */
  | { kind: "yield_curve"; tenors: number[] };

export type SeriesRole =
  | "benchmark"
  | "deflator"
  | "accrual_index"
  | "discount_curve"
  | "fx";

export interface SeriesDescriptor {
  id: string; // 'br.cdi' — must be prefixed with the pack id
  label: string;
  kind: SeriesKind;
  sourceId: string;
  roles: SeriesRole[];
}

// ---------------------------------------------------------------------------
// §4.1 Instrument kinds
// ---------------------------------------------------------------------------

export type IdentifierSpec = "isin" | "ticker" | "custom";

export interface InstrumentKind {
  id: string; // 'br.tesouro_direto'
  label: string;
  valuation: ValuationStrategy;
  /** Validates `assets.metadata` in application code, never in the database. */
  metadataSchema: ZodType;
  identifier: IdentifierSpec;
  quoteCurrency: CurrencyCode;
}

// ---------------------------------------------------------------------------
// §7 Price source adapters
// ---------------------------------------------------------------------------

export type SourceCapability = "spot" | "historical" | "series" | "fx";

export interface FetchRequest {
  capability: SourceCapability;
  /** Asset identifiers or series ids the source is being asked for. */
  refs: string[];
  from?: IsoDate;
  to?: IsoDate;
}

export interface PackHttpResponse {
  status: number;
  headers: Record<string, string>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/**
 * The only HTTP client a pack may use. The kernel implementation applies the
 * source's declared rate limit, retries with backoff, sets the project
 * user-agent and records/replays fixtures. Global `fetch` and `axios` are
 * banned inside packs/ by lint (PACKS.md §7 rule 1).
 */
export interface PackHttp {
  get(url: string, init?: { headers?: Record<string, string> }): Promise<PackHttpResponse>;
}

export interface FetchContext {
  http: PackHttp;
  /** Only the env vars the source declared in `envVars` are visible here. */
  env: Readonly<Record<string, string | undefined>>;
  /** Wall clock, injectable so fixtures replay deterministically. */
  now(): Date;
  /**
   * Aborted when this source's slice of the invocation budget is spent.
   * `ctx.http` is already bound to it, so an in-flight request is cancelled for
   * free. An adapter that parses a large body MUST also poll this inside its
   * loop: a `Promise.race` around the whole parse returns early while the
   * underlying work keeps burning the invocation (plan §0.1).
   *
   * On abort an adapter returns a warning and NO points. A partially parsed
   * range is indistinguishable from a genuinely short one, and the scheduler
   * would record it as covered.
   */
  signal: AbortSignal;
  /** Milliseconds left before `signal` aborts. Never negative. */
  remainingMs(): number;
}

export interface FetchPoint {
  ref: string; // asset identifier or series id
  date: IsoDate;
  value: DecimalString; // never a JS number
  currency: CurrencyCode | null;
  /** Required for yield-curve series; absent for every scalar series and asset price. */
  tenorDays?: number;
}

/**
 * What a source is able to say about ONE requested ref over a bounded window.
 *
 * This exists so the scheduler never has to read warning prose to decide
 * whether a watermark may advance (plan §0.1, §3.2):
 *
 * - `complete: true` with no points means "successfully checked, nothing
 *   exists" — the only way an empty interval may certify itself as covered.
 * - `complete: false` means "known incomplete". When `returned` starts after
 *   `requested`, `returned.from` is the source's honest lower availability
 *   boundary and is persisted as `unavailable_before` rather than being
 *   re-requested every night.
 */
export interface RefCoverage {
  ref: string;
  /** The window the adapter actually asked upstream for. */
  requested: { from: IsoDate; to: IsoDate };
  /** Span of the points returned for this ref, or null when there were none. */
  returned: { from: IsoDate; to: IsoDate } | null;
  /** True only when the source authoritatively covered the whole request. */
  complete: boolean;
  /**
   * The source's honest lower availability boundary: it confirmed it cannot
   * serve ANY observation before this date, whatever window is requested.
   *
   * This must be stated EXPLICITLY rather than inferred from `returned`,
   * because the case that matters most is the one where nothing came back at
   * all. A source with a rolling window (brapi's free plan reaches back three
   * months) asked for a window entirely older than that returns no points and
   * `complete: false` — indistinguishable from a transient failure. The
   * scheduler would then refuse to advance and re-request the identical
   * unreachable chunk on every run, forever.
   *
   * Set it whenever the source KNOWS the limit; leave it undefined when a lack
   * of data means "temporarily unavailable" rather than "structurally
   * unreachable".
   */
  unavailableBefore?: IsoDate;
}

export interface FetchResult {
  points: FetchPoint[];
  warnings: string[];
  /**
   * One entry per requested ref, for bounded (`from`/`to`) requests only.
   * Omitted for unbounded `spot` requests, which carry no interval to cover.
   */
  coverage?: RefCoverage[];
}

export interface PriceSource {
  id: string; // 'br.bcb_sgs'
  label: string;
  homepage: string;
  /** Must match an entry in packs/LICENSES.md (PACKS.md §11.6). */
  license: string;
  auth: "none" | "api_key";
  /** Documented; if any is absent at runtime the source is disabled, never crashes. */
  envVars?: string[];
  rateLimit: { requests: number; perSeconds: number };
  capabilities: SourceCapability[];
  fetch(req: FetchRequest, ctx: FetchContext): Promise<FetchResult>;
}

// ---------------------------------------------------------------------------
// §9 Calendars
// ---------------------------------------------------------------------------

export interface MarketCalendar {
  timezone: string; // IANA
  weekend: number[]; // JS getDay() values, e.g. [0, 6]
  holidays(year: number): IsoDate[];
  settlement: "T+0" | "T+1" | "T+2";
}

// ---------------------------------------------------------------------------
// §4 The pack manifest
// ---------------------------------------------------------------------------

export type PackStatus = "draft" | "supported" | "unmaintained";

export interface MarketPack {
  apiVersion: typeof PACK_API_VERSION;
  /** ISO 3166-1 alpha-2 lower-case ('br', 'uk'), or the reserved 'global'. */
  id: string;
  name: string;
  currency: CurrencyCode;
  locale: string; // BCP-47, number/date formatting only
  instruments: InstrumentKind[];
  series: SeriesDescriptor[];
  sources: PriceSource[];
  calendar: MarketCalendar;
  maintainers: string[]; // GitHub handles → CODEOWNERS
  status: PackStatus;
  /**
   * Other pack ids whose series/sources this pack may reference
   * (e.g. 'br' depends on 'global' for USDBRL). Referential integrity resolves
   * within the pack or a declared dependency (PACKS.md §11.2).
   */
  dependencies?: string[];
}
