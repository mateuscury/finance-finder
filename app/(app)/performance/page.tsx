import Link from "next/link";
import { PACKS } from "@/packs";
import type { SeriesDescriptor } from "@/packs/types";
import { requireUser } from "@/lib/auth/session";
import { seriesReturn } from "@/lib/calc/benchmark";
import { addDays } from "@/lib/calc/dates";
import { KernelDecimal } from "@/lib/calc/decimal";
import { stalenessWindowFor } from "@/lib/calc/portfolio";
import { realReturn } from "@/lib/calc/real";
import type { Observed } from "@/lib/calc/staleness";
import type { KDecimal } from "@/lib/calc/decimal";
import { copyFor } from "@/lib/copy";
import { formatDate, formatPercent } from "@/lib/format";
import { readLedger, SERIES_LOOKBACK_DAYS, toPortfolioInput } from "@/lib/ledger/rows";
import { readSnapshotRange, readSnapshotTotals } from "@/lib/ledger/snapshots";
import { PeriodNav, ToggleNav } from "@/app/(app)/_components/period-nav";
import { PerformanceChart } from "@/app/(app)/_charts/performance-chart";
import { coverTotals } from "@/app/(app)/_models/coverage";
import { baseFlowsOf } from "@/app/(app)/_models/flows";
import { periodFrom } from "@/app/(app)/_models/period";
import { benchmarkSelection, performanceModel, type BenchmarkSeries } from "@/app/(app)/_models/performance";
import styles from "./page.module.css";

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined);

/**
 * Performance (SPEC §9 screen 2; US-010): TWR from the snapshot totals and
 * the cash flows, MWR over the same window, the cumulative line against the
 * benchmark-role series of the user's packs, nominal or deflated by the
 * deflator role. Period, benchmarks and real are links that rewrite the
 * query; nothing here is client state.
 */
export default async function PerformancePage({ searchParams }: PageProps<"/performance">) {
  const { client } = await requireUser();
  const params = await searchParams;
  const [range, read0] = await Promise.all([
    readSnapshotRange(client),
    readLedger(client, PACKS, { prices: "latest", seriesFrom: "9999-12-31" }),
  ]);
  const copy = copyFor(read0.settings.locale);
  const locale = read0.settings.locale;
  const c = copy.screens.performance;

  // The dates that have snapshots, to resolve the period.
  const allTotals = range.first ? await readSnapshotTotals(client) : [];
  const period = periodFrom(
    first(params.period),
    range,
    allTotals.map((t) => t.date),
  );
  const wantReal = first(params.real) === "1";
  const benchmarkParam = first(params.benchmarks);

  if (!period) {
    return (
      <main>
        <h1>{c.title}</h1>
        <p className="muted">{copy.empty.performanceHistory}</p>
      </main>
    );
  }

  // Series from the period start less the lookback: what seriesReturn and realReturn need.
  const read = await readLedger(client, PACKS, {
    prices: "latest",
    seriesFrom: addDays(period.from, -SERIES_LOOKBACK_DAYS),
  });
  const input = toPortfolioInput(read);
  // Which dates are valuation points (decision 53): every open holding confidently valued.
  const totals = coverTotals(
    allTotals.filter((t) => t.date >= period.from && t.date <= period.to),
    read.transactions,
  );
  const { flows, dropped } = baseFlowsOf(read, input);
  // Holdable packs first, so the default benchmark is the market's own, not a dependency's FX series.
  const holdableFirst = [
    ...read.packs.filter((p) => p.instruments.length > 0),
    ...read.packs.filter((p) => p.instruments.length === 0),
  ];
  const available = holdableFirst.flatMap((p) => p.series.map((s) => ({ pack: p, s })));
  const selected = benchmarkSelection(
    available.map((a) => a.s),
    benchmarkParam,
  );
  const packOf = (s: SeriesDescriptor) => available.find((a) => a.s.id === s.id)!.pack;
  const confidentDates = totals.filter((t) => t.complete).map((t) => t.date);
  const ctxFor = (s: SeriesDescriptor, date: string) => {
    const pack = packOf(s);
    // A global series (7-day calendar) is judged under the first holdable pack's window.
    const holdable = read.packs.find((p) => p.instruments.length > 0) ?? pack;
    return { calendar: pack.calendar, windowDays: stalenessWindowFor(input, holdable.id, date) };
  };
  const benchmarks: BenchmarkSeries[] = selected.map((s) => ({
    descriptor: s,
    points: confidentDates.map((date) => ({
      date,
      value: seriesReturn(s, input.market, period.from, date, ctxFor(s, date)),
    })),
  }));
  const deflator = available.map((a) => a.s).find((s) => s.roles.includes("deflator")) ?? null;

  // The cumulative portfolio line, then its real counterpart per point.
  const nominal = performanceModel({ period, totals, flows, droppedFlows: dropped, benchmarks, real: null });
  let real: Array<{ date: string; value: Observed<KDecimal> }> | null = null;
  if (wantReal && deflator && nominal.empty === null) {
    real = nominal.points.map((p) => ({
      date: p.date,
      value:
        p.portfolio === null
          ? { status: "unpriced" as const, reason: "no_observation" as const }
          : realReturn(new KernelDecimal(p.portfolio), input.market, deflator, period.from, p.date),
    }));
  }
  const model = real ? performanceModel({ period, totals, flows, droppedFlows: dropped, benchmarks, real }) : nominal;

  const query = { benchmarks: benchmarkParam, real: wantReal ? "1" : undefined };
  const withQuery = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ period: period.key, ...query, ...over })) if (v) p.set(k, v);
    return `/performance?${p.toString()}`;
  };
  const benchmarkToggles = available
    .map((a) => a.s)
    .filter((s) => s.roles.includes("benchmark"))
    .map((s) => {
      const on = selected.some((x) => x.id === s.id);
      const next = on ? selected.filter((x) => x.id !== s.id).map((x) => x.id) : [...selected.map((x) => x.id), s.id];
      return {
        key: s.id,
        label: s.label,
        on,
        href: withQuery({ benchmarks: next.length > 0 ? next.join(",") : "none" }),
      };
    });

  const rate = (r: string | null) => (r === null ? null : formatPercent(r, locale));
  const twr = rate(model.twr.rate);
  const mwr = rate(model.mwr.rate);
  const pct = (v: string | null) => (v === null ? "—" : formatPercent(v, locale).text);
  const chartSeries = [
    { key: "portfolio", label: c.portfolio, accent: true },
    ...(real ? [{ key: "real", label: c.real }] : []),
    ...selected.map((s) => ({ key: s.id, label: s.label })),
  ];
  const chartPoints = model.points.map((p) => ({
    x: formatDate(p.date, locale),
    values: {
      portfolio: p.portfolio === null ? null : { y: p.portfolio, label: pct(p.portfolio) },
      ...(real
        ? { real: p.real === null ? null : { y: p.real, label: pct(p.real), stale: p.staleMarks.includes("real") } }
        : {}),
      ...Object.fromEntries(
        selected.map((s) => [
          s.id,
          p.benchmarks[s.id] === null
            ? null
            : { y: p.benchmarks[s.id]!, label: pct(p.benchmarks[s.id]), stale: p.staleMarks.includes(s.id) },
        ]),
      ),
    },
  }));
  const anyBenchmarkPoint = benchmarks.some((b) => b.points.some((p) => p.value.status !== "unpriced"));

  return (
    <main>
      <h1>{c.title}</h1>
      <PeriodNav copy={copy} current={period.key} base="/performance" query={query} />
      <p className="muted">{c.over({ from: formatDate(period.from, locale), to: formatDate(period.to, locale) })}</p>

      {model.empty === "history" ? (
        <p className="muted">{copy.empty.performanceHistory}</p>
      ) : (
        <>
          <dl className={styles.figures}>
            <div>
              <dt>{c.twr}</dt>
              <dd className={`display ${styles.figure} ${twr?.direction ?? ""}`}>{twr ? twr.text : "—"}</dd>
              <dd className="muted">{c.twrHelp}</dd>
            </div>
            <div>
              <dt>{c.mwr}</dt>
              <dd className={`display ${styles.figure} ${mwr?.direction ?? ""}`}>{mwr ? mwr.text : "—"}</dd>
              <dd className="muted">{model.mwr.reason ? c.mwrReason[model.mwr.reason] : c.mwrHelp}</dd>
            </div>
          </dl>
          {model.chain && (model.chain.from !== period.from || model.chain.to !== period.to) ? (
            <p className="muted">
              {c.chainSpan({ from: formatDate(model.chain.from, locale), to: formatDate(model.chain.to, locale) })}
            </p>
          ) : null}
          {(model.partial || model.excludedDates.length > 0 || model.twr.ignored > 0) && (
            <p role="status">
              {model.twr.skipped > 0 ? `${c.skipped({ n: model.twr.skipped })} ` : null}
              {dropped > 0 ? `${c.droppedFlows({ n: dropped })} ` : null}
              {model.excludedDates.length > 0 ? `${c.excludedDates({ n: model.excludedDates.length })} ` : null}
              {model.twr.ignored > 0 ? c.ignored({ n: model.twr.ignored }) : null}
            </p>
          )}

          <h2 className={styles.label}>{c.chart}</h2>
          <ToggleNav label={c.benchmarks} items={benchmarkToggles} />
          {deflator ? (
            <ToggleNav
              label={`${c.nominal} / ${c.real}`}
              items={[
                { key: "nominal", label: c.nominal, on: !wantReal, href: withQuery({ real: undefined }) },
                { key: "real", label: c.real, on: wantReal, href: withQuery({ real: "1" }) },
              ]}
            />
          ) : null}
          {wantReal && deflator ? <p className="muted">{c.realHelp({ series: deflator.label })}</p> : null}
          <PerformanceChart series={chartSeries} points={chartPoints} locale={locale} />
          {selected.length > 0 && !anyBenchmarkPoint ? (
            <p className="muted">{copy.empty.performanceBenchmarks}</p>
          ) : null}
          <p className="muted">
            <Link href="/">{copy.nav.overview}</Link>
          </p>
        </>
      )}
    </main>
  );
}
