import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { fakeClient } from "@/lib/testing/fake-client";
import { readLedger, resolveAssets, toCashFlow, toPrice, toSeries, toTransaction } from "./rows";

describe("row mappers keep money as the text PostgREST returned", () => {
  it("transactions: numeric(24,10) text with its scale, fx_rate null", () => {
    const row = toTransaction({
      id: "t1",
      asset_id: "a1",
      trade_date: "2026-02-02",
      type: "buy",
      quantity: "100.0000000000",
      unit_price: "150.0000000000",
      currency: "BRL",
      fees: "4.9000000000",
      fx_rate: null,
    });
    expect(row).toEqual({
      id: "t1",
      assetId: "a1",
      tradeDate: "2026-02-02",
      type: "buy",
      quantity: "100.0000000000",
      unitPrice: "150.0000000000",
      currency: "BRL",
      fees: "4.9000000000",
      fxRate: null,
    });
    expect(typeof row.quantity).toBe("string");
  });

  it("cash flows, prices and series", () => {
    expect(toCashFlow({ id: "c", date: "2026-01-15", amount: "-4648.5000000000", currency: "BRL" })).toEqual({
      id: "c",
      date: "2026-01-15",
      amount: "-4648.5000000000",
      currency: "BRL",
    });
    expect(
      toPrice({ asset_id: "a", date: "2026-02-10", price: "151.0000000000", currency: "BRL", source_id: "br.brapi" }),
    ).toEqual({ assetId: "a", date: "2026-02-10", price: "151.0000000000", currency: "BRL", sourceId: "br.brapi" });
    expect(toSeries({ series_id: "br.cdi", date: "2026-02-10", value: "0.0005000000", tenor_days: 0 })).toEqual({
      seriesId: "br.cdi",
      date: "2026-02-10",
      value: "0.0005000000",
      tenorDays: 0,
    });
  });
});

describe("resolveAssets", () => {
  const base = { identifier: "X", name: "X", native_currency: "BRL", metadata: {} };
  it("resolves registered kinds and keeps unknown ones aside, never dropping a row", () => {
    const { assets, unresolved } = resolveAssets(
      [
        { id: "1", pack_id: "br", instrument_kind: "br.fii", ...base },
        { id: "2", pack_id: "br", instrument_kind: "br.nope", ...base },
        { id: "3", pack_id: "zz", instrument_kind: "zz.thing", ...base },
      ],
      PACKS,
    );
    expect(assets.map((a) => [a.id, a.instrumentKind.id])).toEqual([["1", "br.fii"]]);
    expect(unresolved.map((u) => u.id)).toEqual(["2", "3"]);
  });
});

describe("readLedger price modes (Milestone 4 D-13)", () => {
  const settings = {
    base_currency: "BRL",
    enabled_packs: [],
    locale: "pt-BR",
    theme: "system",
    last_export_at: null,
    csv_column_map: null,
  };
  const empty = { data: [], error: null };

  it("bounds the price history read by pricesFrom", async () => {
    const { client, calls } = fakeClient({
      user_settings: { select: { data: settings } },
      assets: { select: empty },
      transactions: { select: empty },
      cash_flows: { select: empty },
      prices: { select: empty },
    });
    await readLedger(client, PACKS, { pricesFrom: "2026-01-01" });
    const priceRead = calls.find((c) => c.table === "prices")!;
    expect(priceRead.filters).toEqual([["date", "gte", "2026-01-01"]]);
  });

  it("reads one row per asset from the latest-price view in latest mode", async () => {
    const { client, calls } = fakeClient({
      user_settings: { select: { data: settings } },
      assets: { select: empty },
      transactions: { select: empty },
      cash_flows: { select: empty },
      asset_latest_prices: {
        select: {
          data: [{ asset_id: "a", date: "2026-02-27", price: "39.60", currency: "BRL", source_id: "br.brapi" }],
        },
      },
    });
    const read = await readLedger(client, PACKS, { prices: "latest" });
    expect(calls.some((c) => c.table === "prices")).toBe(false);
    expect(calls.some((c) => c.table === "asset_latest_prices")).toBe(true);
    expect(read.prices).toEqual([
      { assetId: "a", date: "2026-02-27", price: "39.60", currency: "BRL", sourceId: "br.brapi" },
    ]);
  });
});

describe("readLedger under the service role (userId given)", () => {
  const settings = {
    base_currency: "BRL",
    enabled_packs: ["br"],
    locale: "pt-BR",
    theme: "system",
    last_export_at: null,
    csv_column_map: null,
  };
  const empty = { data: [], error: null };

  it("filters every user table by the id, prices by the user's asset ids in chunks, and series from the lookback", async () => {
    const assets = Array.from({ length: 150 }, (_, i) => ({
      id: `a${i}`,
      pack_id: "br",
      instrument_kind: "br.fii",
      identifier: `T${i}`,
      name: `T${i}`,
      native_currency: "BRL",
      metadata: {},
    }));
    const { client, calls } = fakeClient({
      user_settings: { select: { data: settings } },
      assets: { select: { data: assets } },
      transactions: {
        select: {
          data: [
            {
              id: "t1",
              asset_id: "a0",
              trade_date: "2026-02-02",
              type: "buy",
              quantity: "1",
              unit_price: "1",
              currency: "BRL",
              fees: "0",
              fx_rate: null,
            },
          ],
        },
      },
      cash_flows: { select: empty },
      prices: { select: empty },
      series_points: { select: empty },
    });
    const read = await readLedger(client, PACKS, { userId: "u1" });
    for (const table of ["user_settings", "assets", "transactions", "cash_flows"]) {
      expect(calls.find((c) => c.table === table)!.filters, table).toContainEqual(["user_id", "eq", "u1"]);
    }
    // 150 asset ids → two chunks of at most 100.
    const priceReads = calls.filter((c) => c.table === "prices");
    expect(priceReads.map((c) => (c.filters[0][2] as string[]).length)).toEqual([100, 50]);
    // Series from the earliest trade less the lookback, for the packs in scope.
    const series = calls.find((c) => c.table === "series_points")!;
    expect(series.filters).toContainEqual(["date", "gte", "2025-12-02"]);
    expect(read.packs.map((p) => p.id).sort()).toEqual(["br", "global"]);
    expect(read.assets).toHaveLength(150);
  });

  it("falls back to the instance defaults when the account has no settings row, and reads no series without a trade", async () => {
    const { client, calls } = fakeClient({
      user_settings: { select: { data: null } },
      assets: { select: empty },
      transactions: { select: empty },
      cash_flows: { select: empty },
      prices: { select: empty },
    });
    const read = await readLedger(client, PACKS);
    expect(read.settings.base_currency).toBe("BRL");
    expect(calls.some((c) => c.table === "series_points")).toBe(false);
    expect(read.series).toEqual([]);
  });

  it("throws a code-only message when the settings read fails", async () => {
    const { client } = fakeClient({
      user_settings: { select: { error: { code: "42501", message: "permission denied for table user_settings" } } },
    });
    await expect(readLedger(client, PACKS)).rejects.toThrow(/^ledger: settings \(42501\)$/);
  });

  it("keeps an unregistered kind as unresolved rather than dropping the asset (decision 4)", () => {
    const { assets, unresolved } = resolveAssets(
      [
        {
          id: "a",
          pack_id: "br",
          instrument_kind: "br.fii",
          identifier: "HGLG11",
          name: "x",
          native_currency: "BRL",
          metadata: {},
        },
        {
          id: "b",
          pack_id: "xx",
          instrument_kind: "xx.thing",
          identifier: "?",
          name: "y",
          native_currency: "BRL",
          metadata: {},
        },
      ],
      PACKS,
    );
    expect(assets.map((a) => a.id)).toEqual(["a"]);
    expect(unresolved).toEqual([{ id: "b", packId: "xx", instrumentKind: "xx.thing", identifier: "?", name: "y" }]);
  });
});
