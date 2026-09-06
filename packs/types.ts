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

export const PACK_API_VERSION = 1 as const;

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
  | { kind: "rate_daily"; dayCount: DayCount }
  | { kind: "rate_annual"; dayCount: DayCount }
  | { kind: "index_level" }
  | { kind: "inflation_index"; interpolation: "none" | "linear_daily" }
  | { kind: "fx_rate"; base: CurrencyCode; quote: CurrencyCode }
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
  log(message: string): void;
}

export interface FetchPoint {
  ref: string; // asset identifier or series id
  date: IsoDate;
  value: DecimalString; // never a JS number
  currency: CurrencyCode | null;
}

export interface FetchResult {
  points: FetchPoint[];
  warnings: string[];
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
