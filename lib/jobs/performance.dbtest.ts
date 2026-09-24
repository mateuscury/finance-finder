/**
 * The performance budgets (MILESTONES.md §4 decision 44; D-23;
 * docs/milestone-4-execution.md P6-U1) measured against the real database
 * over a synthetic five-year, twenty-asset ledger.
 *
 * OPT-IN: `FF_BUDGETS=1 pnpm test:db`. It seeds ~20k rows and builds ~1,250
 * snapshot days, which is minutes, not seconds — CI runs the rest of the
 * tier without it. This is the one documented exception to "the tier never
 * skips": the skip is the absence of an explicit request, not a missing
 * stack, and it names the variable that turns it on.
 *
 * What it proves: every figure in `docs/performance-budgets.md` is a
 * measurement of this tree, reproducible by the command above.
 *
 * Reads are timed through the USER's own client, under RLS, because that is
 * what a screen pays. The snapshot job is timed through the service role,
 * because that is what cron uses.
 */
import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { holdingsModel } from "@/app/(app)/_models/holdings";
import { overviewModel } from "@/app/(app)/_models/overview";
import { allocationModel } from "@/app/(app)/_models/allocation";
import { maturitiesModel } from "@/app/(app)/_models/maturities";
import { contributionModel } from "@/app/(app)/_models/contribution";
import { performanceModel, benchmarkSelection, type BenchmarkSeries } from "@/app/(app)/_models/performance";
import { coverTotals } from "@/app/(app)/_models/coverage";
import { baseFlowsOf } from "@/app/(app)/_models/flows";
import { periodFrom } from "@/app/(app)/_models/period";
import { valueLedger } from "@/app/(app)/_lib/valuation";
import { readContributionWindow } from "@/app/(app)/contribution/_read";
import { seriesReturn } from "@/lib/calc/benchmark";
import { contribution } from "@/lib/calc/contribution";
import { addDays } from "@/lib/calc/dates";
import { stalenessWindowFor } from "@/lib/calc/portfolio";
import { parseCsv } from "@/lib/csv/parse";
import { writeCsv } from "@/lib/csv/write";
import { countLedger, listAssets, listTransactions } from "@/lib/ledger/queries";
import { readLedger, SERIES_LOOKBACK_DAYS, toPortfolioInput } from "@/lib/ledger/rows";
import { readSnapshotRange, readSnapshotRowsAt, readSnapshotTotals } from "@/lib/ledger/snapshots";
import { readStatus } from "@/lib/ledger/status";
import { assertStackReachable, createDbTestClient, createThrowawayUser } from "@/lib/testing/db";
import { seedGoldenPortfolio } from "@/lib/testing/golden";
import { summariseLedger, syntheticLedger } from "@/lib/testing/synthetic";
import type { Db } from "@/lib/supabase/types";
import { runSnapshots } from "./snapshots";
import { createSnapshotStore } from "./snapshots-store";

/** Decision 44's thresholds. A measurement outside one fails the run. */
const SNAPSHOT_DAYS_PER_SECOND = 50;
const READ_BUDGET_MS = 500;
const CSV_ROWS = 20_000;
const RUNS = 5;

const enabled = process.env.FF_BUDGETS === "1";
const suite = enabled ? describe : describe.skip;

interface Timing {
  label: string;
  p50: number;
  min: number;
  max: number;
  budget: number | null;
}

const timings: Timing[] = [];

async function measure<T>(
  label: string,
  fn: () => Promise<T> | T,
  runs = RUNS,
  budget: number | null = READ_BUDGET_MS,
) {
  let last: T | undefined;
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    last = await fn();
    ms.push(performance.now() - t0);
  }
  const sorted = [...ms].sort((a, b) => a - b);
  timings.push({
    label,
    p50: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    budget,
  });
  return last as T;
}

function table(): string {
  const width = Math.max(...timings.map((t) => t.label.length), 5);
  const head = `${"read".padEnd(width)} | ${"p50 ms".padStart(9)} | ${"min".padStart(8)} | ${"max".padStart(8)} | budget`;
  const rows = timings.map((t) => {
    const verdict = t.budget === null ? "—" : t.p50 <= t.budget ? `ok (<${t.budget} ms)` : `OVER ${t.budget} ms`;
    return `${t.label.padEnd(width)} | ${t.p50.toFixed(1).padStart(9)} | ${t.min.toFixed(1).padStart(8)} | ${t.max.toFixed(1).padStart(8)} | ${verdict}`;
  });
  return [head, "-".repeat(head.length), ...rows].join("\n");
}

suite("performance budgets (decision 44)", () => {
  it(
    "a five-year, twenty-asset ledger stays inside every budget",
    async () => {
      const admin = createDbTestClient();
      await assertStackReachable(admin);
      const owner = await createThrowawayUser(admin);
      let client: Db | null = null;
      try {
        const fixture = syntheticLedger(20260924);
        const shape = summariseLedger(fixture);
        const today = fixture.asOf;

        const seedStart = performance.now();
        await seedGoldenPortfolio(admin, owner.userId, fixture, { series: true });
        const seedMs = performance.now() - seedStart;

        // --- the job, under the service role, as cron runs it.
        const store = createSnapshotStore(admin, PACKS);
        const runStart = performance.now();
        const summary = await runSnapshots({
          scope: { kind: "users", userIds: [owner.userId] },
          budgetMs: 15 * 60_000,
          reserveMs: 0,
          now: () => new Date(`${today}T23:00:00Z`),
          store,
        });
        const runMs = performance.now() - runStart;
        const user = summary.users[0];
        expect(user.status).toBe("complete");
        const daysPerSecond = user.daysBuilt / (runMs / 1000);

        // --- the screens, under RLS, as the owner pays for them.
        client = await owner.signIn();
        const db = client;

        const read = await measure("readLedger (prices: latest)", () => readLedger(db, PACKS, { prices: "latest" }));
        const fullRead = await measure("readLedger (full history)", () => readLedger(db, PACKS));
        const totals = await measure("readSnapshotTotals (5 years)", () => readSnapshotTotals(db));
        const counts = await measure("countLedger", () => countLedger(db));
        const assets = await measure("listAssets", () => listAssets(db, PACKS));
        await measure("listTransactions (page 1)", () => listTransactions(db, 1));
        const dividends = await measure("listTransactions (type filter)", () =>
          listTransactions(db, 1, { type: "dividend" }),
        );
        const range = await measure("readSnapshotRange", () => readSnapshotRange(db));
        const latestRows = await measure("readSnapshotRowsAt (latest)", () => readSnapshotRowsAt(db, range.last!));
        const status = await measure("readStatus", () => readStatus(db, PACKS, process.env, today));

        const input = toPortfolioInput(read);
        const { valuation } = await measure("valueLedger (kernel, today)", () => valueLedger(input, today));

        // --- the view models, over the reads above.
        await measure("holdingsModel (Assets)", () =>
          holdingsModel({
            valuation,
            transactions: read.transactions,
            assets,
            baseCurrency: read.settings.base_currency,
            today,
          }),
        );
        const previousRows = totals.at(-2) ? await readSnapshotRowsAt(db, totals.at(-2)!.date) : [];
        await measure("overviewModel", () =>
          overviewModel({
            counts,
            settings: read.settings,
            valuation,
            unpricedAssets: status.unpricedAssets,
            totals: totals.slice(-90),
            latestRows,
            previousRows,
            assets: read.assets,
            names: read.names,
          }),
        );
        await measure("allocationModel", () =>
          allocationModel({ rows: latestRows, assets: read.assets, names: read.names }),
        );
        await measure("maturitiesModel", () => maturitiesModel({ read, input, today, valuation }));

        // Performance: the period, the covered totals, the benchmark line.
        const period = periodFrom(
          "all",
          range,
          totals.map((t) => t.date),
        )!;
        const perfRead = await measure("readLedger (Performance window)", () =>
          readLedger(db, PACKS, { prices: "latest", seriesFrom: addDays(period.from, -SERIES_LOOKBACK_DAYS) }),
        );
        const perfInput = toPortfolioInput(perfRead);
        const covered = await measure("coverTotals", () =>
          coverTotals(
            totals.filter((t) => t.date >= period.from && t.date <= period.to),
            perfRead.transactions,
          ),
        );
        const { flows, dropped } = baseFlowsOf(perfRead, perfInput);
        const available = perfRead.packs.flatMap((p) => p.series.map((s) => ({ pack: p, s })));
        const selected = benchmarkSelection(
          available.map((a) => a.s),
          undefined,
        );
        const confidentDates = covered.filter((t) => t.complete).map((t) => t.date);
        const benchmarks: BenchmarkSeries[] = await measure("seriesReturn (benchmark line)", () =>
          selected.map((s) => {
            const pack = available.find((a) => a.s.id === s.id)!.pack;
            return {
              descriptor: s,
              points: confidentDates.map((date) => ({
                date,
                value: seriesReturn(s, perfInput.market, period.from, date, {
                  calendar: pack.calendar,
                  windowDays: stalenessWindowFor(perfInput, pack.id, date),
                }),
              })),
            };
          }),
        );
        await measure("performanceModel", () =>
          performanceModel({ period, totals: covered, flows, droppedFlows: dropped, benchmarks, real: null }),
        );

        // Contribution reads its own window, then the kernel attributes it.
        const window = await measure("readContributionWindow", () => readContributionWindow(db, "all"), 3);
        // Stated as a precondition: an empty window over a seeded five-year
        // ledger is a different failure from a slow one, and should say so
        // rather than throw on a null further down.
        expect(window.oversold).toEqual([]);
        const { period: windowPeriod, input: windowInput, start: windowStart, end: windowEnd } = window;
        if (!windowPeriod || !windowInput || !windowStart || !windowEnd)
          throw new Error("budgets: the contribution window came back empty over a seeded five-year ledger");
        await measure(
          "contribution + contributionModel",
          () => {
            const result = contribution({
              input: windowInput,
              from: windowPeriod.from,
              to: windowPeriod.to,
              start: windowStart,
              end: windowEnd,
              flows: window.flows,
            });
            return contributionModel({
              result,
              identifiers: Object.fromEntries(window.read.assets.map((a) => [a.id, a.identifier])),
              names: window.read.names,
              droppedFlows: window.dropped,
            });
          },
          3,
        );

        // --- import: a 20k-row file through the reader that parses it (D-23).
        const header = ["date", "type", "identifier", "quantity", "unit_price", "currency", "fees"];
        const csv = writeCsv(
          header,
          Array.from({ length: CSV_ROWS }, (_, i) => [
            "2026-01-05",
            "buy",
            `TICK${i % 500}`,
            "10",
            "12.34",
            read.settings.base_currency,
            "1.50",
          ]),
        );
        const parsed = await measure(`parseCsv (${CSV_ROWS} rows)`, () => parseCsv(csv), 3);
        expect(parsed.ok && parsed.rows.length).toBe(CSV_ROWS);

        // --- the report. Printed whether or not an assertion below fails.
        const lines = [
          "",
          "Performance budgets — decision 44",
          `  ledger:    ${shape.assets} assets · ${shape.transactions} transactions · ${shape.cashFlows} cash flows · ${shape.prices} prices · ${shape.seriesPoints} series points`,
          `  window:    ${shape.from} → ${shape.to}`,
          `  seeding:   ${(seedMs / 1000).toFixed(1)} s`,
          `  snapshots: ${user.daysBuilt} days, ${user.rowsWritten} rows in ${(runMs / 1000).toFixed(1)} s = ${daysPerSecond.toFixed(1)} days/s (budget ≥ ${SNAPSHOT_DAYS_PER_SECOND})`,
          `  reads:     ${RUNS} runs each, p50 (3 for the heavy three)`,
          "",
          table(),
          "",
          `  transactions in the filtered list: ${dividends.total} dividends of ${counts.transactions}`,
          `  full read: ${fullRead.prices.length} prices, ${fullRead.series.length} series points`,
          "",
        ];
        console.info(lines.join("\n"));

        expect(daysPerSecond).toBeGreaterThanOrEqual(SNAPSHOT_DAYS_PER_SECOND);
        const over = timings.filter((t) => t.budget !== null && t.p50 > t.budget);
        expect(over.map((t) => `${t.label} ${t.p50.toFixed(0)} ms`)).toEqual([]);
      } finally {
        await owner.remove();
      }
    },
    30 * 60_000,
  );
});
