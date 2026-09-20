import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { resolveAssets, toCashFlow, toPrice, toSeries, toTransaction } from "./rows";

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
    expect(row).toEqual({ id: "t1", assetId: "a1", tradeDate: "2026-02-02", type: "buy", quantity: "100.0000000000", unitPrice: "150.0000000000", currency: "BRL", fees: "4.9000000000", fxRate: null });
    expect(typeof row.quantity).toBe("string");
  });

  it("cash flows, prices and series", () => {
    expect(toCashFlow({ id: "c", date: "2026-01-15", amount: "-4648.5000000000", currency: "BRL" })).toEqual({ id: "c", date: "2026-01-15", amount: "-4648.5000000000", currency: "BRL" });
    expect(toPrice({ asset_id: "a", date: "2026-02-10", price: "151.0000000000", currency: "BRL", source_id: "br.brapi" })).toEqual({ assetId: "a", date: "2026-02-10", price: "151.0000000000", currency: "BRL", sourceId: "br.brapi" });
    expect(toSeries({ series_id: "br.cdi", date: "2026-02-10", value: "0.0005000000", tenor_days: 0 })).toEqual({ seriesId: "br.cdi", date: "2026-02-10", value: "0.0005000000", tenorDays: 0 });
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
