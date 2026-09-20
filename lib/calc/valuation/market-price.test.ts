import { describe, expect, it } from "vitest";
import { KernelDecimal } from "../decimal";
import { addDays } from "../dates";
import { isKernelError } from "../errors";
import { buildMarketData, type PriceObservation } from "../types";
import { valueMarketPrice } from "./market-price";
import { NAV_EXTRA_DAYS, valueNavUnitPrice } from "./nav-unit-price";
import type { ValuationContext } from "./result";
import { asset, kind, sevenDay, money } from "./testkit";

const FII = kind("br.fii", { kind: "market_price", sourceId: "br.brapi" });
const FUND = kind("br.fund", { kind: "nav_unit_price", sourceId: "br.fund_nav" });
const price = (assetId: string, date: string, p: string, currency = "BRL"): PriceObservation => ({ assetId, date, price: p, currency, sourceId: "br.brapi" });
const W = 5;

function ctx(prices: PriceObservation[]): ValuationContext {
  return { market: buildMarketData(prices, []), calendar: sevenDay, windowDays: W, series: [] };
}

describe("market_price", () => {
  const a = asset("a1", FII);
  const qty = new KernelDecimal("100");

  it("values quantity × the price observed on the date", () => {
    const r = valueMarketPrice(a, qty, "2026-02-13", ctx([price("a1", "2026-02-13", "12.5")]));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(money(r.native)).toBe("BRL 1250");
    expect(r.unitValue.toFixed()).toBe("12.5");
    expect(r.priceDate).toBe("2026-02-13");
  });

  it("carries forward within the window, is stale beyond, unpriced with nothing at or before", () => {
    const c = ctx([price("a1", "2026-02-13", "12.5")]);
    expect(valueMarketPrice(a, qty, addDays("2026-02-13", W), c)).toMatchObject({ status: "carried_forward", priceDate: "2026-02-13" });
    const stale = valueMarketPrice(a, qty, addDays("2026-02-13", W + 1), c);
    expect(stale.status).toBe("stale");
    if (stale.status === "stale") expect(money(stale.lastKnown)).toBe("BRL 1250");
    expect(valueMarketPrice(a, qty, "2026-02-12", c)).toEqual({ status: "unpriced", reason: "no_price" });
  });

  it("throws currency_mismatch on a price in another currency, without the value", () => {
    try {
      valueMarketPrice(a, qty, "2026-02-13", ctx([price("a1", "2026-02-13", "12.5", "USD")]));
      expect.unreachable();
    } catch (err) {
      expect(isKernelError(err, "currency_mismatch")).toBe(true);
      expect(JSON.stringify((err as { details: unknown }).details)).not.toContain("12.5");
    }
  });
});

describe("nav_unit_price", () => {
  it("tolerates two extra calendar days over the market window, exactly at the boundary", () => {
    const f = asset("f1", FUND);
    const c = ctx([price("f1", "2026-02-13", "1.5")]);
    const q = new KernelDecimal("10");
    for (let age = 0; age <= W + NAV_EXTRA_DAYS + 1; age += 1) {
      const asOf = addDays("2026-02-13", age);
      const market = valueMarketPrice(f, q, asOf, c).status;
      const nav = valueNavUnitPrice(f, q, asOf, c).status;
      expect(market).toBe(age === 0 ? "ok" : age <= W ? "carried_forward" : "stale");
      expect(nav).toBe(age === 0 ? "ok" : age <= W + NAV_EXTRA_DAYS ? "carried_forward" : "stale");
    }
  });
});
