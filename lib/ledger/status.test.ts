import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { fakeClient } from "@/lib/testing/fake-client";
import { lastTradingDay, readStatus, tradingDaysBack } from "./status";

const settings = (over: Record<string, unknown> = {}) => ({
  base_currency: "BRL",
  enabled_packs: ["br"],
  locale: "pt-BR",
  theme: "system",
  last_export_at: null,
  csv_column_map: null,
  ...over,
});
const asset = (id: string, kind: string) => ({
  id,
  pack_id: "br",
  instrument_kind: kind,
  identifier: id,
  name: id,
  native_currency: "BRL",
  metadata: {},
});
const TODAY = "2026-09-21"; // a Monday

describe("readStatus", () => {
  it("is quiet on a fresh instance: no assets, no trades, no nudge", async () => {
    const { client } = fakeClient({
      user_settings: { select: { data: settings({ enabled_packs: [] }) } },
      assets: { select: { data: [] } },
      snapshot_markers: { select: { data: { last_snapshot_date: null, earliest_trade_date: null } } },
      transactions: { select: { count: 0 } },
    });
    expect(await readStatus(client, PACKS, { BRAPI_TOKEN: "x" }, TODAY)).toEqual({
      unpricedAssets: 0,
      rebuild: null,
      disabledSources: [],
      exportNudge: null,
      ingestStale: null,
      failingSources: [],
      lastIngestRunAt: null,
      snapshotsThrough: null,
      snapshotsWrittenAt: null,
    });
  });

  it("counts unpriced market/NAV assets only, names a disabled source's variable, and reports the rebuild gap", async () => {
    const { client } = fakeClient({
      user_settings: { select: { data: settings() } },
      assets: {
        select: {
          data: [
            asset("a1", "br.fii"),
            asset("a2", "br.stock"),
            asset("a3", "br.cdb"),
            asset("a4", "br.tesouro_direto"),
          ],
        },
      },
      asset_latest_prices: { select: { data: [{ asset_id: "a1" }] } },
      snapshot_markers: { select: { data: { last_snapshot_date: "2026-09-15", earliest_trade_date: "2026-01-15" } } },
      transactions: { select: { count: 3 } },
    });
    const s = await readStatus(client, PACKS, {}, TODAY);
    expect(s.unpricedAssets).toBe(2); // a2 (stock) and a4 (NAV); the CDB accrues
    expect(s.disabledSources).toEqual([{ sourceId: "br.brapi", variable: "BRAPI_TOKEN" }]);
    // No write time on the marker at all: the gap is stalled, not progressing.
    expect(s.rebuild).toEqual({ from: "2026-01-15", through: "2026-09-15", target: "2026-09-21", stalled: true });
    expect(s.exportNudge).toEqual({ lastExportAt: null });
  });

  it("nudges only when data exists and the export is older than 30 days", async () => {
    const make = (last_export_at: string | null, count: number) =>
      fakeClient({
        user_settings: { select: { data: settings({ last_export_at, enabled_packs: [] }) } },
        assets: { select: { data: [] } },
        snapshot_markers: { select: { data: null } },
        transactions: { select: { count } },
      }).client;
    expect((await readStatus(make("2026-09-01T00:00:00Z", 5), PACKS, {}, TODAY)).exportNudge).toBeNull();
    expect((await readStatus(make("2026-08-01T00:00:00Z", 5), PACKS, {}, TODAY)).exportNudge).toEqual({
      lastExportAt: "2026-08-01T00:00:00Z",
    });
    expect((await readStatus(make(null, 0), PACKS, {}, TODAY)).exportNudge).toBeNull();
  });

  it("no rebuild when the snapshots reach the last trading day", async () => {
    const { client } = fakeClient({
      user_settings: { select: { data: settings() } },
      assets: { select: { data: [asset("a3", "br.cdb")] } },
      snapshot_markers: { select: { data: { last_snapshot_date: "2026-09-18", earliest_trade_date: "2026-01-15" } } },
      transactions: { select: { count: 1 } },
    });
    // Sunday: the last trading day is Friday the 18th, which the snapshots reach.
    expect((await readStatus(client, PACKS, { BRAPI_TOKEN: "x" }, "2026-09-20")).rebuild).toBeNull();
  });
});

describe("lastTradingDay", () => {
  it("walks back over a weekend and a holiday to the last day any calendar trades", () => {
    const br = PACKS.find((p) => p.id === "br")!.calendar;
    expect(lastTradingDay([br], "2026-09-20")).toBe("2026-09-18");
    expect(lastTradingDay([br], "2026-09-18")).toBe("2026-09-18");
    // 7 Sep 2026 (Independence Day) is a Monday holiday.
    expect(lastTradingDay([br], "2026-09-07")).toBe("2026-09-04");
  });
});

describe("liveness (SPEC §9.2; decision 63)", () => {
  const held = (over: Record<string, unknown> = {}) => ({
    user_settings: { select: { data: settings({ created_at: "2026-01-01T00:00:00Z", ...over }) } },
    assets: { select: { data: [asset("a1", "br.cdb")] } },
    snapshot_markers: {
      select: {
        data: {
          last_snapshot_date: TODAY,
          earliest_trade_date: "2026-01-15",
          last_snapshot_written_at: `${TODAY}T23:00:00Z`,
        },
      },
    },
    transactions: { select: { count: 3 } },
  });
  const env = { BRAPI_TOKEN: "x" };

  it("tradingDaysBack walks over a weekend", () => {
    const calendars = PACKS.filter((p) => p.instruments.length > 0).map((p) => p.calendar);
    // 2026-09-21 is a Monday; two trading days back is the previous Thursday.
    expect(tradingDaysBack(calendars, "2026-09-21", 2)).toBe("2026-09-17");
  });

  it("reports no price run when every cursor is older than two trading days", async () => {
    const { client } = fakeClient({
      ...held(),
      ingest_cursors: {
        select: { data: [{ source_id: "br.bcb_sgs", last_run_at: "2026-09-10T21:30:00Z", last_error: null }] },
      },
    });
    const s = await readStatus(client, PACKS, env, TODAY);
    expect(s.ingestStale).toEqual({ lastRunAt: "2026-09-10T21:30:00Z" });
  });

  it("is silent when a cursor ran inside the window", async () => {
    const { client } = fakeClient({
      ...held(),
      ingest_cursors: {
        select: { data: [{ source_id: "br.bcb_sgs", last_run_at: "2026-09-18T21:30:00Z", last_error: null }] },
      },
    });
    expect((await readStatus(client, PACKS, env, TODAY)).ingestStale).toBeNull();
  });

  it("is silent on an account younger than the window, which has missed no run", async () => {
    const { client } = fakeClient({
      ...held({ created_at: `${TODAY}T08:00:00Z` }),
      ingest_cursors: { select: { data: [] } },
    });
    expect((await readStatus(client, PACKS, env, TODAY)).ingestStale).toBeNull();
  });

  it("names a source whose last attempt recorded an error", async () => {
    const { client } = fakeClient({
      ...held(),
      ingest_cursors: {
        select: {
          data: [
            { source_id: "br.bcb_sgs", last_run_at: `${TODAY}T21:30:00Z`, last_error: "rate_limited" },
            { source_id: "br.tesouro", last_run_at: `${TODAY}T21:30:00Z`, last_error: null },
          ],
        },
      },
    });
    const s = await readStatus(client, PACKS, env, TODAY);
    expect(s.failingSources).toEqual([{ sourceId: "br.bcb_sgs", code: "rate_limited" }]);
    expect(s.ingestStale).toBeNull();
  });

  it("calls a gap nothing has written into for two trading days stalled, not rebuilding", async () => {
    const stale = {
      ...held(),
      snapshot_markers: {
        select: {
          data: {
            last_snapshot_date: "2026-09-10",
            earliest_trade_date: "2026-01-15",
            last_snapshot_written_at: "2026-09-10T23:00:00Z",
          },
        },
      },
      ingest_cursors: {
        select: { data: [{ source_id: "br.bcb_sgs", last_run_at: `${TODAY}T21:30:00Z`, last_error: null }] },
      },
    };
    expect((await readStatus(fakeClient(stale).client, PACKS, env, TODAY)).rebuild).toMatchObject({ stalled: true });

    // The same gap, written into today: a rebuild in progress, not a stall.
    const moving = {
      ...stale,
      snapshot_markers: {
        select: {
          data: {
            last_snapshot_date: "2026-09-10",
            earliest_trade_date: "2026-01-15",
            last_snapshot_written_at: `${TODAY}T02:00:00Z`,
          },
        },
      },
    };
    expect((await readStatus(fakeClient(moving).client, PACKS, env, TODAY)).rebuild).toMatchObject({ stalled: false });
  });
});
