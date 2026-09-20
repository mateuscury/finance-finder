import { describe, expect, it } from "vitest";
import { brCalendar } from "@/packs/br/calendar";
import { brInstruments } from "@/packs/br/instruments";
import { KernelDecimal } from "./decimal";
import { Money } from "./money";
import { stalenessWindowFor, toBase, valuePortfolio, type PortfolioInput } from "./portfolio";
import { buildMarketData, type LedgerTransaction, type PriceObservation } from "./types";
import { asset, kind, pt, sevenDay, USDBRL, money } from "./valuation/testkit";

const FII = brInstruments.find((k) => k.id === "br.fii")!;
const US_STOCK = kind("zz.stock", { kind: "market_price", sourceId: "zz" }, "USD");

let seq = 0;
function txn(assetId: string, tradeDate: string, type: LedgerTransaction["type"], quantity: string, unitPrice: string, currency = "BRL"): LedgerTransaction {
  seq += 1;
  return { id: `t${seq}`, assetId, tradeDate, type, quantity, unitPrice, currency, fees: "0", fxRate: null };
}
const price = (assetId: string, date: string, p: string, currency = "BRL"): PriceObservation => ({ assetId, date, price: p, currency, sourceId: "x" });

const AS_OF = "2026-02-13";
const input: PortfolioInput = {
  baseCurrency: "BRL",
  assets: [
    asset("fresh", FII),
    asset("old", FII),
    asset("sold", FII),
    asset("nofx", US_STOCK, {}, "USD", "zz"),
    asset("fxcf", US_STOCK, {}, "USD", "zz"),
  ],
  transactions: [
    txn("fresh", "2026-02-02", "buy", "10", "9"),
    txn("old", "2026-02-02", "buy", "5", "20"),
    txn("sold", "2026-02-02", "buy", "5", "20"),
    txn("sold", "2026-02-10", "sell", "-5", "22"),
    txn("nofx", "2026-02-02", "buy", "1", "100", "USD"),
    txn("fxcf", "2026-02-02", "buy", "2", "100", "USD"),
  ],
  market: buildMarketData(
    [
      price("fresh", AS_OF, "10"),
      price("old", "2026-02-01", "21"), // 12 days old: beyond BR's 5-day window
      price("sold", AS_OF, "30"),
      price("nofx", AS_OF, "150", "USD"),
      price("fxcf", AS_OF, "150", "USD"),
    ],
    [pt("global.usdbrl", "2026-02-12", "5")],
  ),
  calendars: new Map([
    ["br", brCalendar],
    ["zz", sevenDay],
  ]),
  series: [],
};
const withFx: PortfolioInput = { ...input, series: [USDBRL] };

describe("valuePortfolio", () => {
  it("sums only confident rows, keeps stale rows for display, lists what it excluded, skips sold assets", () => {
    const v = valuePortfolio(input, AS_OF);
    expect(v.asOf).toBe(AS_OF);
    expect(money(v.totalBase)).toBe("BRL 100");
    expect(v.holdings.map((h) => [h.assetId, h.status, h.carriedForward, money(h.marketValueBase)])).toEqual([
      ["fresh", "ok", false, "BRL 100"],
      ["old", "stale", true, "BRL 105"],
    ]);
    expect(v.excluded).toEqual([
      { assetId: "old", status: "stale", lastKnownBase: Money.parse("105", "BRL"), priceDate: "2026-02-01", fxDate: null },
      { assetId: "nofx", status: "unpriced", reason: "no_fx_series" },
      { assetId: "fxcf", status: "unpriced", reason: "no_fx_series" },
    ]);
    const fresh = v.holdings[0];
    expect(fresh.quantity.toFixed()).toBe("10");
    expect(fresh.priceNative.toFixed()).toBe("10");
    expect(fresh.priceDate).toBe(AS_OF);
    expect(fresh.fxRate).toBeNull();
    expect(fresh.fxDate).toBeNull();
    expect(money(fresh.marketValueNative)).toBe("BRL 100");
  });

  it("status is the worse of the price and FX legs; the FX leg is judged under the asset's pack window", () => {
    const v = valuePortfolio(withFx, AS_OF);
    const row = v.holdings.find((h) => h.assetId === "fxcf")!;
    // Price fresh on asOf, FX observed the day before: within the 7-day pack's 1-day window.
    expect(row.status).toBe("carried_forward");
    expect(row.carriedForward).toBe(true);
    expect(row.fxRate).toEqual(new KernelDecimal(5));
    expect(row.fxDate).toBe("2026-02-12");
    expect(money(row.marketValueBase)).toBe("BRL 1500");
    // fresh 100 + fxcf 1500 + nofx 1 × 150 × 5: `nofx` only lacked FX in `input`.
    expect(money(v.totalBase)).toBe("BRL 2350");
    // Two days later the FX leg is stale and the row drops out of the total.
    const later = valuePortfolio({ ...withFx, market: buildMarketData([price("fxcf", "2026-02-14", "150", "USD")], [pt("global.usdbrl", "2026-02-12", "5")]) }, "2026-02-14");
    expect(later.holdings.find((h) => h.assetId === "fxcf")!.status).toBe("stale");
    expect(money(later.totalBase)).toBe("BRL 0");
  });

  it("an unpriced price leg is excluded with its reason and never reaches FX", () => {
    const v = valuePortfolio({ ...withFx, market: buildMarketData([], []) }, AS_OF);
    expect(v.holdings).toEqual([]);
    expect(v.excluded.map((e) => [e.assetId, e.status === "unpriced" ? e.reason : e.status])).toEqual([
      ["fresh", "no_price"],
      ["old", "no_price"],
      ["nofx", "no_price"],
      ["fxcf", "no_price"],
    ]);
  });

  it("throws invalid_input when an asset's pack has no calendar", () => {
    expect(() => valuePortfolio({ ...input, calendars: new Map([["br", brCalendar]]) }, AS_OF)).toThrow(/invalid_input/);
  });
});

describe("toBase and the window", () => {
  it("the BR window in 2026 is Carnival's four closed days plus one", () => {
    expect(stalenessWindowFor(input, "br", AS_OF)).toBe(5);
    expect(stalenessWindowFor(input, "zz", AS_OF)).toBe(1);
  });

  it("converts through the FX series under the pack's window, or reports why not", () => {
    const usd = Money.parse("10", "USD");
    expect(toBase(withFx, Money.parse("10", "BRL"), AS_OF, "br")).toEqual({ status: "ok", value: Money.parse("10", "BRL"), observedOn: AS_OF });
    expect(toBase(withFx, usd, "2026-02-12", "zz")).toEqual({ status: "ok", value: Money.parse("50", "BRL"), observedOn: "2026-02-12" });
    expect(toBase(withFx, usd, AS_OF, "zz")).toEqual({ status: "carried_forward", value: Money.parse("50", "BRL"), observedOn: "2026-02-12" });
    expect(toBase(withFx, usd, "2026-02-14", "zz")).toEqual({ status: "stale", lastKnown: Money.parse("50", "BRL"), observedOn: "2026-02-12" });
    expect(toBase(input, usd, AS_OF, "zz")).toEqual({ status: "unpriced", reason: "no_fx_series" });
  });
});
