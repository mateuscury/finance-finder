import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { brCalendar } from "@/packs/br/calendar";
import { contribution } from "./contribution";
import { KernelDecimal, ZERO } from "./decimal";
import { addDays } from "./dates";
import { valuePortfolio, type PortfolioInput } from "./portfolio";
import { buildMarketData, type LedgerTransaction, type PriceObservation } from "./types";
import { asset, kind, money, pt, sevenDay, USDBRL } from "./valuation/testkit";

const STOCK = kind("br.stock", { kind: "market_price", sourceId: "x" });
const US = kind("zz.stock", { kind: "market_price", sourceId: "x" }, "USD");
let seq = 0;
const txn = (assetId: string, tradeDate: string, type: LedgerTransaction["type"], quantity: string, unitPrice: string, currency = "BRL", fees = "0"): LedgerTransaction => ({
  id: `t${(seq += 1)}`,
  assetId,
  tradeDate,
  type,
  quantity,
  unitPrice,
  currency,
  fees,
  fxRate: null,
});
const price = (assetId: string, date: string, p: string, currency = "BRL"): PriceObservation => ({ assetId, date, price: p, currency, sourceId: "x" });

const FROM = "2026-02-10";
const TO = "2026-02-13";
const calendars = new Map([
  ["br", brCalendar],
  ["zz", sevenDay],
]);

function run(input: PortfolioInput, flows: { date: string; amount: string }[] = []) {
  return contribution({ input, from: FROM, to: TO, start: valuePortfolio(input, FROM), end: valuePortfolio(input, TO), flows });
}

describe("contribution", () => {
  const input: PortfolioInput = {
    baseCurrency: "BRL",
    assets: [asset("a", STOCK), asset("b", STOCK)],
    transactions: [txn("a", "2026-02-02", "buy", "10", "10"), txn("b", "2026-02-02", "buy", "10", "20"), txn("a", "2026-02-11", "buy", "5", "11")],
    market: buildMarketData([price("a", FROM, "10"), price("b", FROM, "20"), price("a", TO, "12"), price("b", TO, "19")], []),
    calendars,
    series: [],
  };

  it("gain_i = V_i(to) − V_i(from) − netInvested_i, shared denominator D = V(from) + Σ flows", () => {
    const r = run(input, [{ date: "2026-02-11", amount: "55" }, { date: FROM, amount: "1000" }, { date: "2026-02-14", amount: "1000" }]);
    expect(r.denominator.toFixed()).toBe("355");
    expect(r.assets.map((a) => [a.assetId, money(a.gain!), a.contribution!.toFixed()])).toEqual([
      ["a", "BRL 25", new KernelDecimal(25).div(355).toFixed()],
      ["b", "BRL -10", new KernelDecimal(-10).div(355).toFixed()],
    ]);
    expect(r.total!.toFixed()).toBe(new KernelDecimal(15).div(355).toFixed());
    expect(r.partial).toBe(false);
  });

  it("D ≤ 0 makes every contribution null with zero_start_value", () => {
    const empty: PortfolioInput = { ...input, transactions: [txn("a", "2026-02-11", "buy", "5", "11")] };
    const r = run(empty);
    expect(r.total).toBeNull();
    expect(r.partial).toBe(true);
    expect(r.assets.every((a) => a.contribution === null && a.reason === "zero_start_value")).toBe(true);
  });

  it("an asset stale or unpriced at either end is null with the reason; the total is partial", () => {
    // b's only price is nine days before `from`: stale at both ends under BR's 5-day window.
    const stale: PortfolioInput = { ...input, market: buildMarketData([price("a", FROM, "10"), price("a", TO, "12"), price("b", "2026-02-01", "19")], []) };
    const r = run(stale);
    expect(r.assets.find((a) => a.assetId === "b")).toEqual({ assetId: "b", gain: null, contribution: null, reason: "stale" });
    // D is the confident V(from) = 100 (a only); gain_a = 180 − 100 − 55.
    expect(r.denominator.toFixed()).toBe("100");
    expect(r.assets.find((a) => a.assetId === "a")!.contribution!.toFixed()).toBe("0.25");
    expect(r.partial).toBe(true);
    const unpriced: PortfolioInput = { ...input, market: buildMarketData([price("a", FROM, "10"), price("a", TO, "12")], []) };
    expect(run(unpriced).assets.find((a) => a.assetId === "b")!.reason).toBe("no_price");
  });

  it("converts each transaction at its own date through the FX series, never the row's fx_rate", () => {
    const usd: PortfolioInput = {
      baseCurrency: "BRL",
      assets: [asset("u", US, {}, "USD", "zz")],
      transactions: [txn("u", "2026-02-02", "buy", "1", "100", "USD"), { ...txn("u", "2026-02-11", "buy", "1", "100", "USD"), fxRate: "9999" }],
      market: buildMarketData(
        [price("u", FROM, "100", "USD"), price("u", TO, "100", "USD")],
        [pt("global.usdbrl", FROM, "5"), pt("global.usdbrl", "2026-02-11", "6"), pt("global.usdbrl", TO, "5.5")],
      ),
      calendars,
      series: [USDBRL],
    };
    const r = run(usd, [{ date: "2026-02-11", amount: "600" }]);
    // V(from) = 500; buy 100 USD at 6 = 600; V(to) = 2 × 100 × 5.5 = 1100 → gain 0.
    expect(r.denominator.toFixed()).toBe("1100");
    expect(money(r.assets[0].gain!)).toBe("BRL 0");
    // A buy two days past the last FX point is stale under the 7-day calendar's 1-day window.
    const noFx = run({
      ...usd,
      transactions: [txn("u", "2026-02-02", "buy", "1", "100", "USD"), txn("u", "2026-02-12", "buy", "1", "100", "USD")],
      market: buildMarketData([price("u", FROM, "100", "USD"), price("u", TO, "100", "USD")], [pt("global.usdbrl", FROM, "5"), pt("global.usdbrl", TO, "5.5")]),
    });
    expect(noFx.assets[0]).toEqual({ assetId: "u", gain: null, contribution: null, reason: "stale" });
  });

  const px = fc.integer({ min: 100, max: 100000 }).map((n) => new KernelDecimal(n).div(100).toFixed());
  const qty = fc.integer({ min: 1, max: 1000 }).map(String);

  it("property: contributions sum exactly to the simple return (V_to − V_from − Σ invested) / D", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(px, px, qty, qty, px), { minLength: 1, maxLength: 4 }), fc.integer({ min: 0, max: 100000 }), (rows, dep) => {
        const assets = rows.map((_, i) => asset(`a${i}`, STOCK));
        const transactions = rows.flatMap(([, , q0, q1, p1], i) => [txn(`a${i}`, "2026-02-02", "buy", q0, "1"), txn(`a${i}`, "2026-02-11", "buy", q1, p1, "BRL", "1.5")]);
        const prices = rows.flatMap(([p0, p2], i) => [price(`a${i}`, FROM, p0), price(`a${i}`, TO, p2)]);
        const inp: PortfolioInput = { baseCurrency: "BRL", assets, transactions, market: buildMarketData(prices, []), calendars, series: [] };
        const flows = [{ date: "2026-02-11", amount: new KernelDecimal(dep).div(100).toFixed() }];
        const start = valuePortfolio(inp, FROM);
        const end = valuePortfolio(inp, TO);
        const r = contribution({ input: inp, from: FROM, to: TO, start, end, flows });
        const invested = rows.reduce((s, [, , , q1, p1]) => s.plus(new KernelDecimal(q1).times(p1).plus("1.5")), ZERO);
        const simple = end.totalBase.amount.minus(start.totalBase.amount).minus(invested).div(r.denominator);
        expect(r.total!.minus(simple).abs().lt("1e-30")).toBe(true);
        expect(r.assets.reduce((s, a) => s.plus(a.contribution!), ZERO).minus(r.total!).abs().lt("1e-38")).toBe(true);
      }),
    );
  });
});

describe("window", () => {
  it("only flows and transactions in (from, to] count", () => {
    const input: PortfolioInput = {
      baseCurrency: "BRL",
      assets: [asset("a", STOCK)],
      transactions: [txn("a", "2026-02-02", "buy", "10", "10"), txn("a", FROM, "buy", "1", "10"), txn("a", addDays(TO, 1), "buy", "100", "10")],
      market: buildMarketData([price("a", FROM, "10"), price("a", TO, "11")], []),
      calendars,
      series: [],
    };
    const r = run(input, [{ date: FROM, amount: "10" }, { date: addDays(TO, 1), amount: "1000" }]);
    expect(r.denominator.toFixed()).toBe("110");
    expect(money(r.assets[0].gain!)).toBe("BRL 11");
  });
});
