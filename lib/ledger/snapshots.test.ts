import { describe, expect, it } from "vitest";
import { fakeClient } from "@/lib/testing/fake-client";
import { readSnapshotRange, readSnapshotRowsAt, readSnapshotRowsBetween, readSnapshotTotals } from "./snapshots";

const dbRow = (asset_id: string, date: string, over: Record<string, unknown> = {}) => ({
  asset_id,
  date,
  quantity: "100.0000000000",
  price_native: "162.4000000000",
  price_date: date,
  fx_rate: null,
  fx_date: null,
  base_currency: "BRL",
  market_value_base: "16240.0000000000",
  carried_forward: false,
  status: "ok",
  ...over,
});

describe("snapshot readers", () => {
  it("readSnapshotTotals maps the view's columns, keeps totals as text, and bounds by date", async () => {
    const { client, calls } = fakeClient({
      snapshot_totals: {
        select: {
          data: [
            {
              date: "2026-02-10",
              base_currency: "BRL",
              total_base: "99200.940648",
              rows: 7,
              stale_rows: 0,
              carried_rows: 1,
            },
          ],
        },
      },
    });
    const totals = await readSnapshotTotals(client, { from: "2026-01-01", to: "2026-03-01" });
    expect(totals).toEqual([
      { date: "2026-02-10", baseCurrency: "BRL", totalBase: "99200.940648", rows: 7, staleRows: 0, carriedRows: 1 },
    ]);
    expect(typeof totals[0].totalBase).toBe("string");
    expect(calls[0].filters).toEqual([
      ["date", "gte", "2026-01-01"],
      ["date", "lte", "2026-03-01"],
    ]);
    const { client: unbounded, calls: c2 } = fakeClient({ snapshot_totals: { select: { data: [] } } });
    expect(await readSnapshotTotals(unbounded)).toEqual([]);
    expect(c2[0].filters).toEqual([]);
  });

  it("readSnapshotRange reads the first and last dates, null on an empty table", async () => {
    const { client } = fakeClient({
      portfolio_snapshots: { select: [{ data: { date: "2026-02-10" } }, { data: { date: "2026-02-27" } }] },
    });
    expect(await readSnapshotRange(client)).toEqual({ first: "2026-02-10", last: "2026-02-27" });
    const { client: empty } = fakeClient({ portfolio_snapshots: { select: { data: null } } });
    expect(await readSnapshotRange(empty)).toEqual({ first: null, last: null });
    const { client: failing } = fakeClient({
      portfolio_snapshots: { select: { error: { code: "XX000", message: "postgres://x" } } },
    });
    await expect(readSnapshotRange(failing)).rejects.toThrow(/^snapshots: first \(XX000\)$/);
  });

  it("readSnapshotRowsAt and readSnapshotRowsBetween map text rows and apply their filters", async () => {
    const { client, calls } = fakeClient({
      portfolio_snapshots: {
        select: {
          data: [
            dbRow("a1", "2026-02-27", {
              status: "carried_forward",
              carried_forward: true,
              fx_rate: "5.1",
              fx_date: "2026-02-26",
            }),
          ],
        },
      },
    });
    const at = await readSnapshotRowsAt(client, "2026-02-27");
    expect(at).toEqual([
      {
        assetId: "a1",
        date: "2026-02-27",
        quantity: "100.0000000000",
        priceNative: "162.4000000000",
        priceDate: "2026-02-27",
        fxRate: "5.1",
        fxDate: "2026-02-26",
        baseCurrency: "BRL",
        marketValueBase: "16240.0000000000",
        carriedForward: true,
        status: "carried_forward",
      },
    ]);
    expect(calls[0].filters).toEqual([["date", "eq", "2026-02-27"]]);
    expect(calls[0].payload).toMatchObject({ cols: expect.stringContaining("quantity::text") });

    await readSnapshotRowsBetween(client, "2026-02-01", "2026-02-27");
    expect(calls[1].filters).toEqual([
      ["date", "gte", "2026-02-01"],
      ["date", "lte", "2026-02-27"],
    ]);
  });
});
