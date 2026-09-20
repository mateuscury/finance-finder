/**
 * The golden-portfolio runner (PACKS.md §11.5; docs/milestone-2-plan.md
 * Phase 5). A pack ships `fixtures/portfolio.json` and a hand-derived
 * `fixtures/expected.json`; `runGolden` turns the portfolio into every figure
 * the kernel can state about it, and `compareGolden` checks the two agree to
 * an absolute tolerance. The conformance suite calls both; a contributor runs
 * them locally.
 *
 * The runner is the ONE place the kernel meets a pack manifest: the caller
 * passes the packs in (the registry itself is banned from kernel imports),
 * and every asset's instrument kind, series and calendar are resolved from
 * them. `expected.json` is never edited to match the output here — a mismatch
 * is a bug in one of the two, found by rederiving by hand.
 */
import { z } from "zod";
import type { IsoDate, MarketCalendar, MarketPack, SeriesDescriptor } from "@/packs/types";
import { CurrencyCodeSchema, DecimalStringSchema, IsoDateSchema, PrefixedIdSchema } from "@/packs/schema";
import { contribution } from "./contribution";
import { KernelDecimal, isDecimalString, parseDecimal, toDecimalString } from "./decimal";
import { compareDates } from "./dates";
import { KernelError } from "./errors";
import { mwr } from "./mwr";
import { valuePortfolio, type PortfolioInput, type PortfolioValuation } from "./portfolio";
import type { ValueStatus } from "./staleness";
import { twr, type BaseFlow, type ValuationPoint } from "./twr";
import {
  buildMarketData,
  type HoldingAsset,
  type LedgerTransaction,
  type PriceObservation,
  type SeriesObservation,
} from "./types";

const TransactionTypeSchema = z.enum(["buy", "sell", "dividend", "interest", "fee"]);

export const GoldenFixtureSchema = z
  .object({
    $comment: z.string().optional(),
    baseCurrency: CurrencyCodeSchema,
    asOf: IsoDateSchema,
    /** Dates the portfolio is valued on; TWR chains over them. Must include `asOf`. */
    valuationDates: z.array(IsoDateSchema).min(1),
    assets: z.array(
      z.object({
        id: z.string().min(1),
        instrumentKind: PrefixedIdSchema,
        identifier: z.string().min(1),
        nativeCurrency: CurrencyCodeSchema,
        metadata: z.unknown(),
      }),
    ),
    transactions: z.array(
      z.object({
        id: z.string().min(1),
        assetId: z.string().min(1),
        tradeDate: IsoDateSchema,
        type: TransactionTypeSchema,
        quantity: DecimalStringSchema,
        unitPrice: DecimalStringSchema,
        currency: CurrencyCodeSchema,
        fees: DecimalStringSchema.default("0"),
        fxRate: DecimalStringSchema.nullable().default(null),
      }),
    ),
    /** External flows in the base currency. */
    cashFlows: z.array(z.object({ id: z.string().min(1), date: IsoDateSchema, amount: DecimalStringSchema, currency: CurrencyCodeSchema })),
    /** Keyed by asset IDENTIFIER, as a source would return them. */
    prices: z.record(z.string(), z.array(z.object({ date: IsoDateSchema, price: DecimalStringSchema, currency: CurrencyCodeSchema, sourceId: z.string().default("manual") }))),
    /** Keyed by series id. */
    series: z.record(
      PrefixedIdSchema,
      z.array(z.object({ date: IsoDateSchema, value: DecimalStringSchema, tenorDays: z.number().int().nonnegative().default(0) })),
    ),
  })
  .refine((f) => f.valuationDates.includes(f.asOf), { message: "asOf must be one of valuationDates", path: ["asOf"] });

export type GoldenFixture = z.infer<typeof GoldenFixtureSchema>;

export interface GoldenAssetValue {
  native: string;
  base: string;
  status: ValueStatus;
}

export interface GoldenResult {
  asOf: IsoDate;
  valuation: {
    total: string;
    assets: Record<string, GoldenAssetValue>;
    excluded: { assetId: string; status: "stale" | "unpriced"; reason?: string }[];
  };
  /** Confident total on every valuation date, ascending. */
  valuations: Record<IsoDate, string>;
  /** Asset ids whose row was not built on fresh inputs, per date that has any. */
  carriedForward: Record<IsoDate, string[]>;
  twr: string | null;
  mwr: string | null;
  contribution: { assets: Record<string, string | null>; total: string | null };
}

/** The pack that owns an id such as `br.fii`. */
function packOf(packs: readonly MarketPack[], id: string): MarketPack {
  const packId = id.slice(0, id.indexOf("."));
  const pack = packs.find((p) => p.id === packId);
  if (!pack) throw new KernelError("invalid_input", "no pack for id", { id, packId });
  return pack;
}

/** A pack's own series plus those of its declared dependencies, transitively. */
function seriesInScope(packs: readonly MarketPack[], root: MarketPack): SeriesDescriptor[] {
  const seen = new Set<string>();
  const out: SeriesDescriptor[] = [];
  const visit = (p: MarketPack) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out.push(...p.series);
    for (const depId of p.dependencies ?? []) {
      const dep = packs.find((c) => c.id === depId);
      if (dep) visit(dep);
    }
  };
  visit(root);
  return out;
}

function toPortfolioInput(fixture: GoldenFixture, packs: readonly MarketPack[]): PortfolioInput {
  const calendars = new Map<string, MarketCalendar>();
  const series = new Map<string, SeriesDescriptor>();
  const assets: HoldingAsset[] = fixture.assets.map((a) => {
    const pack = packOf(packs, a.instrumentKind);
    const instrumentKind = pack.instruments.find((k) => k.id === a.instrumentKind);
    if (!instrumentKind) throw new KernelError("invalid_input", "unknown instrument kind", { assetId: a.id, instrumentKind: a.instrumentKind });
    calendars.set(pack.id, pack.calendar);
    for (const s of seriesInScope(packs, pack)) series.set(s.id, s);
    return { id: a.id, packId: pack.id, instrumentKind, identifier: a.identifier, nativeCurrency: a.nativeCurrency, metadata: a.metadata };
  });

  const transactions: LedgerTransaction[] = fixture.transactions.map((t) => ({ ...t }));
  const prices: PriceObservation[] = [];
  for (const [identifier, rows] of Object.entries(fixture.prices)) {
    const owners = assets.filter((a) => a.identifier === identifier);
    if (owners.length === 0) throw new KernelError("invalid_input", "prices for an identifier no asset carries", { identifier });
    for (const owner of owners) for (const r of rows) prices.push({ assetId: owner.id, date: r.date, price: r.price, currency: r.currency, sourceId: r.sourceId });
  }
  const observations: SeriesObservation[] = [];
  for (const [seriesId, rows] of Object.entries(fixture.series)) {
    for (const r of rows) observations.push({ seriesId, date: r.date, value: r.value, tenorDays: r.tenorDays });
  }

  return {
    baseCurrency: fixture.baseCurrency,
    assets,
    transactions,
    market: buildMarketData(prices, observations),
    calendars,
    series: [...series.values()],
  };
}

function baseFlows(fixture: GoldenFixture): BaseFlow[] {
  return fixture.cashFlows.map((f) => {
    if (f.currency !== fixture.baseCurrency) {
      throw new KernelError("currency_mismatch", "golden cash flows must be in the base currency", { id: f.id, currency: f.currency, base: fixture.baseCurrency });
    }
    return { date: f.date, amount: f.amount };
  });
}

function summarise(v: PortfolioValuation): GoldenResult["valuation"] {
  const assets: Record<string, GoldenAssetValue> = {};
  for (const h of v.holdings) assets[h.assetId] = { native: h.marketValueNative.toString(), base: h.marketValueBase.toString(), status: h.status };
  return {
    total: v.totalBase.toString(),
    assets,
    excluded: v.excluded.map((e) => (e.status === "unpriced" ? { assetId: e.assetId, status: e.status, reason: e.reason } : { assetId: e.assetId, status: e.status })),
  };
}

export function runGolden(fixture: GoldenFixture, packs: readonly MarketPack[]): GoldenResult {
  const input = toPortfolioInput(fixture, packs);
  const dates = [...fixture.valuationDates].sort(compareDates);
  const flows = baseFlows(fixture);

  const byDate = new Map<IsoDate, PortfolioValuation>();
  const valuations: Record<IsoDate, string> = {};
  const carriedForward: Record<IsoDate, string[]> = {};
  const points: ValuationPoint[] = [];
  for (const date of dates) {
    const v = valuePortfolio(input, date);
    byDate.set(date, v);
    valuations[date] = v.totalBase.toString();
    points.push({ date, value: v.totalBase.toString() });
    const carried = v.holdings.filter((h) => h.carriedForward).map((h) => h.assetId);
    if (carried.length > 0) carriedForward[date] = carried;
  }

  const first = dates[0];
  const atAsOf = byDate.get(fixture.asOf)!;
  const start = byDate.get(first)!;
  const t = twr(points, flows);
  const m = mwr({ from: first, to: fixture.asOf, startValue: start.totalBase.toString(), flows, endValue: atAsOf.totalBase.toString() });
  const c = contribution({ input, from: first, to: fixture.asOf, start, end: atAsOf, flows });

  const contributions: Record<string, string | null> = {};
  for (const a of c.assets) contributions[a.assetId] = a.contribution === null ? null : toDecimalString(a.contribution);

  return {
    asOf: fixture.asOf,
    valuation: summarise(atAsOf),
    valuations,
    carriedForward,
    twr: t.twr === null ? null : toDecimalString(t.twr),
    mwr: m.status === "ok" ? toDecimalString(m.rate) : null,
    contribution: { assets: contributions, total: c.total === null ? null : toDecimalString(c.total) },
  };
}

export interface GoldenMismatch {
  path: string;
  expected: unknown;
  actual: unknown;
}

/** PACKS.md §11.5: absolute tolerance for values and rates alike, compared in Decimal. */
export const GOLDEN_TOLERANCE = "1e-8";

/**
 * Walks `expected` (keys starting with `$` are annotations and skipped) and
 * reports every leaf that differs from `actual`: decimal strings within the
 * tolerance, everything else by equality. Objects must have the same keys —
 * an asset the kernel priced but the derivation did not is a mismatch.
 */
export function compareGolden(actual: unknown, expected: unknown, tolerance = GOLDEN_TOLERANCE, path = ""): GoldenMismatch[] {
  const at = (key: string | number) => (path === "" ? String(key) : `${path}.${key}`);
  if (isDecimalString(expected) && isDecimalString(actual)) {
    const diff = parseDecimal(actual).minus(parseDecimal(expected)).abs();
    return diff.lte(new KernelDecimal(tolerance)) ? [] : [{ path, expected, actual }];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return [{ path, expected, actual }];
    return expected.flatMap((e, i) => compareGolden(actual[i], e, tolerance, at(i)));
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return [{ path, expected, actual }];
    const exp = expected as Record<string, unknown>;
    const act = actual as Record<string, unknown>;
    const keys = Object.keys(exp).filter((k) => !k.startsWith("$"));
    const extra = Object.keys(act).filter((k) => !(k in exp));
    return [
      ...keys.flatMap((k) => (k in act ? compareGolden(act[k], exp[k], tolerance, at(k)) : [{ path: at(k), expected: exp[k], actual: undefined }])),
      ...extra.map((k) => ({ path: at(k), expected: undefined, actual: act[k] })),
    ];
  }
  return Object.is(actual, expected) ? [] : [{ path, expected, actual }];
}
