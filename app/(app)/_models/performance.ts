/**
 * The Performance view model (SPEC §9 screen 2, §6; US-010), pure over what
 * the page read. TWR chains the complete totals of the snapshot dates in
 * the period through the kernel's `twr()` — a date on which a holding is
 * stale or unpriced is not a point (decision 53, `coverTotals`): it is
 * listed and drawn as a gap. MWR is `mwr()`
 * over the same window. The cumulative line is Π(1 + r) − 1 over the
 * kernel's own sub-periods, so the last point IS the TWR. Benchmarks and
 * the real line arrive already computed per point; this model only
 * assembles the rows a chart and a table print.
 */
import type { IsoDate, SeriesDescriptor } from "@/packs/types";
import { KernelDecimal, ONE, toDecimalString } from "@/lib/calc/decimal";
import { mwr } from "@/lib/calc/mwr";
import type { Observed } from "@/lib/calc/staleness";
import { twr, type BaseFlow } from "@/lib/calc/twr";
import type { KDecimal } from "@/lib/calc/decimal";
import type { CoveredTotal } from "./coverage";
import type { Period } from "./period";

export interface BenchmarkSeries {
  descriptor: SeriesDescriptor;
  /** One entry per confident snapshot date in the period: the series' return from the period start. */
  points: ReadonlyArray<{ date: IsoDate; value: Observed<KDecimal> }>;
}

export interface PerformanceInput {
  period: Period;
  /** Every snapshot total in `[from, to]`, ascending, with its coverage (decision 53). */
  totals: readonly CoveredTotal[];
  flows: readonly BaseFlow[];
  droppedFlows: number;
  benchmarks: readonly BenchmarkSeries[];
  /** The deflator applied to each point's cumulative return, when the real toggle is on. */
  real: ReadonlyArray<{ date: IsoDate; value: Observed<KDecimal> }> | null;
}

export interface PerformancePoint {
  date: IsoDate;
  /** Cumulative portfolio return from the period start; null until the first sub-period closes. */
  portfolio: string | null;
  /** Real cumulative return, when asked for and observable. */
  real: string | null;
  /** By series id; null where the series is unpriced on that date. */
  benchmarks: Record<string, string | null>;
  /** True on a benchmark or real point that is stale (last known, not confident). */
  staleMarks: string[];
}

export interface PerformanceModel {
  twr: { rate: string | null; skipped: number; ignored: number };
  mwr: { rate: string | null; reason: "insufficient_flows" | "no_root" | null };
  points: PerformancePoint[];
  /** Snapshot dates in the period that are not valuation points (decision 53): a holding stale or unpriced on them. */
  excludedDates: IsoDate[];
  /** The span the chain actually covers: the first and last complete dates. */
  chain: { from: IsoDate; to: IsoDate } | null;
  /** Flows dropped (decision 54) or sub-periods skipped (decision 2): the figures are partial. */
  partial: boolean;
  empty: "history" | null;
}

const asString = (o: Observed<KDecimal>): string | null =>
  o.status === "ok" || o.status === "carried_forward"
    ? toDecimalString(o.value)
    : o.status === "stale"
      ? toDecimalString(o.lastKnown)
      : null;

export function performanceModel(input: PerformanceInput): PerformanceModel {
  const { period, flows } = input;
  const totals = input.totals.filter((t) => t.date >= period.from && t.date <= period.to);
  const confident = totals.filter((t) => t.complete);
  const excludedDates = totals.filter((t) => !t.complete).map((t) => t.date);
  if (confident.length < 2) {
    return {
      twr: { rate: null, skipped: 0, ignored: 0 },
      mwr: { rate: null, reason: null },
      points: [],
      excludedDates,
      chain: null,
      partial: false,
      empty: "history",
    };
  }

  const t = twr(
    confident.map((c) => ({ date: c.date, value: c.totalBase })),
    flows,
  );
  const start = confident[0];
  const end = confident[confident.length - 1];
  const m = mwr({ from: start.date, to: end.date, startValue: start.totalBase, flows, endValue: end.totalBase });

  // Cumulative growth at each sub-period end; the first confident date is the origin (0).
  const cumulative = new Map<IsoDate, KDecimal>([[start.date, new KernelDecimal(0)]]);
  let growth = ONE;
  for (const sp of t.subPeriods) {
    growth = growth.times(ONE.plus(sp.return));
    cumulative.set(sp.to, growth.minus(ONE));
  }

  const benchAt = new Map<string, Map<IsoDate, Observed<KDecimal>>>();
  for (const b of input.benchmarks) benchAt.set(b.descriptor.id, new Map(b.points.map((p) => [p.date, p.value])));
  const realAt = new Map((input.real ?? []).map((p) => [p.date, p.value]));

  const points: PerformancePoint[] = confident.map((c) => {
    const portfolio = cumulative.get(c.date);
    const staleMarks: string[] = [];
    const benchmarks: Record<string, string | null> = {};
    for (const b of input.benchmarks) {
      const o = benchAt.get(b.descriptor.id)?.get(c.date);
      benchmarks[b.descriptor.id] = o ? asString(o) : null;
      if (o?.status === "stale") staleMarks.push(b.descriptor.id);
    }
    const r = realAt.get(c.date);
    if (r?.status === "stale") staleMarks.push("real");
    return {
      date: c.date,
      portfolio: portfolio === undefined ? null : toDecimalString(portfolio),
      real: r ? asString(r) : null,
      benchmarks,
      staleMarks,
    };
  });

  return {
    twr: { rate: t.twr === null ? null : toDecimalString(t.twr), skipped: t.skipped.length, ignored: t.ignored.length },
    mwr: { rate: m.status === "ok" ? toDecimalString(m.rate) : null, reason: m.status === "ok" ? null : m.reason },
    points,
    excludedDates,
    chain: { from: start.date, to: end.date },
    partial: input.droppedFlows > 0 || t.skipped.length > 0,
    empty: null,
  };
}

/** The benchmark ids to plot: those requested that exist, else the first benchmark-role series. */
export function benchmarkSelection(
  available: readonly SeriesDescriptor[],
  param: string | string[] | undefined,
): SeriesDescriptor[] {
  const benchmarks = available.filter((s) => s.roles.includes("benchmark"));
  const wanted = typeof param === "string" ? param.split(",").filter(Boolean) : [];
  const chosen = benchmarks.filter((s) => wanted.includes(s.id));
  if (chosen.length > 0) return chosen;
  return wanted.length > 0 && wanted.includes("none") ? [] : benchmarks.slice(0, 1);
}
