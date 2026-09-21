import { describe, expect, it } from "vitest";
import { brCalendar } from "@/packs/br/calendar";
import { globalPack } from "@/packs/global";
import { brPack } from "@/packs/br";
import { valuePortfolio } from "@/lib/calc/portfolio";
import { toPortfolioInput, type LedgerRead } from "@/lib/ledger/rows";
import { loadGoldenFixture } from "@/lib/testing/golden";
import {
  isTradingDay,
  markerFor,
  rowsFor,
  runSnapshots,
  tradingCalendars,
  type SnapshotRow,
  type SnapshotStore,
  type SnapshotUser,
} from "./snapshots";

const { fixture, expected } = loadGoldenFixture();

/** The golden portfolio as a LedgerRead, exactly what the store would hand the job. */
function goldenRead(): LedgerRead {
  const kindOf = (id: string) => brPack.instruments.find((k) => k.id === id)!;
  const identifierToId = new Map(fixture.assets.map((a) => [a.identifier, a.id] as const));
  return {
    settings: {
      base_currency: "BRL",
      enabled_packs: ["br"],
      locale: "pt-BR",
      theme: "system",
      last_export_at: null,
      csv_column_map: null,
    },
    assets: fixture.assets.map((a) => ({
      id: a.id,
      packId: "br",
      instrumentKind: kindOf(a.instrumentKind),
      identifier: a.identifier,
      nativeCurrency: a.nativeCurrency,
      metadata: a.metadata,
    })),
    unresolved: [],
    transactions: fixture.transactions,
    cashFlows: fixture.cashFlows,
    prices: Object.entries(fixture.prices).flatMap(([identifier, rows]) =>
      rows.map((r) => ({
        assetId: identifierToId.get(identifier)!,
        date: r.date,
        price: r.price,
        currency: r.currency,
        sourceId: r.sourceId,
      })),
    ),
    series: Object.entries(fixture.series).flatMap(([seriesId, rows]) =>
      rows.map((r) => ({ seriesId, date: r.date, value: r.value, tenorDays: r.tenorDays })),
    ),
    packs: [brPack, globalPack],
  };
}

interface Fake {
  store: SnapshotStore;
  written: Map<string, Map<string, SnapshotRow[]>>; // userId → date → rows
  reads: Array<[string, string]>;
}

function fakeStore(users: SnapshotUser[], read: LedgerRead = goldenRead()): Fake {
  const written = new Map<string, Map<string, SnapshotRow[]>>();
  const reads: Array<[string, string]> = [];
  const store: SnapshotStore = {
    listUsers: async () => users,
    readLedger: async (userId, from) => {
      reads.push([userId, from]);
      return read;
    },
    writeDay: async (userId, date, rows) => {
      (written.get(userId) ?? written.set(userId, new Map()).get(userId)!).set(date, rows);
    },
  };
  return { store, written, reads };
}

const at = (iso: string) => () => new Date(`${iso}T23:00:00Z`);

describe("markerFor / calendars", () => {
  it("starts at the earliest trade, or the day after the last snapshot", () => {
    expect(markerFor({ userId: "u", lastSnapshotDate: null, earliestTradeDate: "2026-01-15" })).toBe("2026-01-15");
    expect(markerFor({ userId: "u", lastSnapshotDate: "2026-02-13", earliestTradeDate: "2026-01-15" })).toBe(
      "2026-02-14",
    );
    expect(markerFor({ userId: "u", lastSnapshotDate: null, earliestTradeDate: null })).toBeNull();
  });

  it("trades on the union of holdable packs' calendars; global (no instruments) does not make every day a trading day", () => {
    const calendars = tradingCalendars(goldenRead());
    expect(calendars).toEqual([brCalendar]);
    expect(isTradingDay(calendars, "2026-02-13")).toBe(true);
    expect(isTradingDay(calendars, "2026-02-14")).toBe(false); // Saturday
    expect(isTradingDay(calendars, "2026-02-16")).toBe(false); // Carnival
    expect(isTradingDay(calendars, "2026-02-18")).toBe(true);
  });
});

describe("rowsFor", () => {
  it("writes exactly valuePortfolio's holdings as decimal strings with decision 22's columns", () => {
    const read = goldenRead();
    const rows = rowsFor("u1", read, "2026-02-19");
    const valuation = valuePortfolio(toPortfolioInput(read), "2026-02-19");
    expect(rows).toHaveLength(valuation.holdings.length);
    const fii = rows.find((r) => r.asset_id === "fii")!;
    expect(fii).toMatchObject({
      user_id: "u1",
      date: "2026-02-19",
      quantity: "120",
      price_native: "155",
      price_date: "2026-02-18",
      fx_rate: null,
      fx_date: null,
      base_currency: "BRL",
      market_value_base: "18600",
      carried_forward: true,
      status: "carried_forward",
    });
    for (const r of rows)
      for (const v of [r.quantity, r.price_native, r.market_value_base]) expect(typeof v).toBe("string");
  });
});

describe("runSnapshots", () => {
  it("builds every trading day from the marker through today, one write per day, and totals match the golden valuations", async () => {
    const fake = fakeStore([{ userId: "u1", lastSnapshotDate: null, earliestTradeDate: "2026-01-15" }]);
    const summary = await runSnapshots({
      scope: { kind: "all_users" },
      budgetMs: 60_000,
      reserveMs: 0,
      now: at("2026-02-27"),
      store: fake.store,
    });
    expect(summary.ok).toBe(true);
    expect(summary.users[0]).toMatchObject({ status: "complete", from: "2026-01-15", to: "2026-02-27" });
    const days = [...fake.written.get("u1")!.keys()];
    expect(days).not.toContain("2026-02-14");
    expect(days).not.toContain("2026-02-16");
    expect(days).toContain("2026-02-18");
    expect(days).toHaveLength(30); // BR business days 15 Jan – 27 Feb 2026
    // The series window is the lookback before the marker.
    expect(fake.reads[0]).toEqual(["u1", "2025-11-14"]);
    // Confident totals per golden date: sum of non-stale rows.
    const valuations = expected.valuations as Record<string, string>;
    for (const [date, total] of Object.entries(valuations)) {
      const rows = fake.written.get("u1")!.get(date)!;
      const sum = rows.filter((r) => r.status !== "stale").reduce((s, r) => s + parseFloat(r.market_value_base), 0);
      expect(Math.abs(sum - parseFloat(total))).toBeLessThan(1e-6);
    }
  });

  it("resumes from the day after the last snapshot and does nothing when caught up", async () => {
    const fake = fakeStore([{ userId: "u1", lastSnapshotDate: "2026-02-25", earliestTradeDate: "2026-01-15" }]);
    const summary = await runSnapshots({
      scope: { kind: "all_users" },
      budgetMs: 60_000,
      reserveMs: 0,
      now: at("2026-02-27"),
      store: fake.store,
    });
    expect([...fake.written.get("u1")!.keys()]).toEqual(["2026-02-26", "2026-02-27"]);
    expect(summary.users[0]).toMatchObject({ status: "complete", daysBuilt: 2 });
    const done = fakeStore([{ userId: "u1", lastSnapshotDate: "2026-02-27", earliestTradeDate: "2026-01-15" }]);
    const nothing = await runSnapshots({
      scope: { kind: "all_users" },
      budgetMs: 60_000,
      reserveMs: 0,
      now: at("2026-02-27"),
      store: done.store,
    });
    expect(nothing.users[0].status).toBe("nothing_to_do");
    expect(done.written.size).toBe(0);
  });

  it("stops between days when the budget is spent, and the next run continues", async () => {
    let tick = 0;
    const clock = () => new Date(Date.parse("2026-02-27T23:00:00Z") + tick++ * 1000);
    const fake = fakeStore([{ userId: "u1", lastSnapshotDate: null, earliestTradeDate: "2026-02-09" }]);
    // Each now() call advances one second; the budget allows about three days.
    const first = await runSnapshots({
      scope: { kind: "all_users" },
      budgetMs: 5_000,
      reserveMs: 0,
      now: clock,
      store: fake.store,
    });
    expect(first.users[0].status).toBe("budget_exhausted");
    const builtFirst = [...fake.written.get("u1")!.keys()];
    expect(builtFirst.length).toBeGreaterThan(0);
    expect(builtFirst.length).toBeLessThan(15);
    const last = builtFirst[builtFirst.length - 1];
    const resumed = fakeStore([{ userId: "u1", lastSnapshotDate: last, earliestTradeDate: "2026-02-09" }]);
    const second = await runSnapshots({
      scope: { kind: "all_users" },
      budgetMs: 60_000,
      reserveMs: 0,
      now: at("2026-02-27"),
      store: resumed.store,
    });
    expect(second.users[0].status).toBe("complete");
    expect([...resumed.written.get("u1")!.keys()][0] > last).toBe(true);
  });

  it("an empty ledger or a marker in the future is nothing_to_do; a store failure is a fixed code", async () => {
    const empty = fakeStore([{ userId: "u1", lastSnapshotDate: null, earliestTradeDate: null }]);
    expect(
      (
        await runSnapshots({
          scope: { kind: "all_users" },
          budgetMs: 1000,
          reserveMs: 0,
          now: at("2026-02-27"),
          store: empty.store,
        })
      ).users[0].status,
    ).toBe("nothing_to_do");
    const failing: SnapshotStore = {
      listUsers: async () => [{ userId: "u1", lastSnapshotDate: null, earliestTradeDate: "2026-02-10" }],
      readLedger: async () => {
        throw new Error("postgres://secret");
      },
      writeDay: async () => {},
    };
    const summary = await runSnapshots({
      scope: { kind: "all_users" },
      budgetMs: 1000,
      reserveMs: 0,
      now: at("2026-02-27"),
      store: failing,
    });
    expect(summary.ok).toBe(false);
    expect(summary.users[0]).toMatchObject({ status: "error", errorCode: "store_failed" });
    expect(JSON.stringify(summary)).not.toContain("postgres://");
  });
});
