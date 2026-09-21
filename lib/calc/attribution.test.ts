import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { brCalendar } from "@/packs/br/calendar";
import { attribution } from "./attribution";
import { KernelDecimal, ONE } from "./decimal";
import type { PortfolioInput } from "./portfolio";
import { buildMarketData, type LedgerTransaction, type PriceObservation } from "./types";
import { asset, kind, pt, sevenDay, USDBRL } from "./valuation/testkit";

const US = kind("zz.stock", { kind: "market_price", sourceId: "x" }, "USD");
const BR = kind("br.stock", { kind: "market_price", sourceId: "x" });
let seq = 0;
const txn = (
  assetId: string,
  tradeDate: string,
  type: LedgerTransaction["type"],
  quantity: string,
  unitPrice: string,
  currency: string,
): LedgerTransaction => ({
  id: `t${(seq += 1)}`,
  assetId,
  tradeDate,
  type,
  quantity,
  unitPrice,
  currency,
  fees: "0",
  fxRate: null,
});
const price = (assetId: string, date: string, p: string, currency: string): PriceObservation => ({
  assetId,
  date,
  price: p,
  currency,
  sourceId: "x",
});
const calendars = new Map([
  ["br", brCalendar],
  ["zz", sevenDay],
]);
const FROM = "2026-02-10";
const MID = "2026-02-11";
const TO = "2026-02-12";

function usdInput(
  prices: PriceObservation[],
  fx: [string, string][],
  transactions: LedgerTransaction[],
): PortfolioInput {
  return {
    baseCurrency: "BRL",
    assets: [asset("u", US, {}, "USD", "zz"), asset("b", BR)],
    transactions,
    market: buildMarketData(
      prices,
      fx.map(([d, v]) => pt("global.usdbrl", d, v)),
    ),
    calendars,
    series: [USDBRL],
  };
}

describe("attribution", () => {
  it("splits total base return into asset and FX with FX as the residual", () => {
    const input = usdInput(
      [price("u", FROM, "100", "USD"), price("u", TO, "110", "USD")],
      [
        [FROM, "5"],
        [TO, "5.5"],
      ],
      [txn("u", "2026-02-02", "buy", "3", "100", "USD")],
    );
    const r = attribution(input, "u", FROM, TO);
    expect(r.rNative?.toFixed()).toBe("0.1");
    expect(r.rBase?.toFixed()).toBe("0.21");
    expect(r.rFx?.toFixed()).toBe("0.1");
    expect(r.boundaries).toEqual([FROM, TO]);
  });

  it("a base-currency holding has R_fx = 0 exactly", () => {
    const input = usdInput(
      [price("b", FROM, "10", "BRL"), price("b", TO, "13", "BRL")],
      [],
      [txn("b", "2026-02-02", "buy", "3", "10", "BRL")],
    );
    const r = attribution(input, "b", FROM, TO);
    expect(r.rNative?.toFixed()).toBe("0.3");
    expect(r.rBase?.toFixed()).toBe("0.3");
    expect(r.rFx?.isZero()).toBe(true);
  });

  it("splits at the asset's transaction dates and values each sub-period with the lots open at its start", () => {
    const input = usdInput(
      [price("u", FROM, "100", "USD"), price("u", MID, "120", "USD"), price("u", TO, "150", "USD")],
      [
        [FROM, "5"],
        [MID, "4"],
        [TO, "6"],
      ],
      [txn("u", "2026-02-02", "buy", "1", "100", "USD"), txn("u", MID, "buy", "9", "120", "USD")],
    );
    const r = attribution(input, "u", FROM, TO);
    expect(r.boundaries).toEqual([FROM, MID, TO]);
    // Native: 100 → 120 → 150 per unit, the 9-unit buy on MID does not enter. Base: 500 → 480 → 900.
    expect(r.rNative?.toFixed()).toBe("0.5");
    expect(r.rBase?.toFixed()).toBe("0.8");
    expect(
      ONE.plus(r.rBase!)
        .minus(ONE.plus(r.rNative!).times(ONE.plus(r.rFx!)))
        .abs()
        .lt("1e-38"),
    ).toBe(true);
    // 5 → 4 → 6: the FX legs chain to 6/5.
    expect(r.rFx?.minus("0.2").abs().lt("1e-38")).toBe(true);
  });

  it("is null with a reason when a boundary is stale or unpriced, or the asset was never held", () => {
    const noPrice = usdInput(
      [price("u", TO, "100", "USD")],
      [
        [FROM, "5"],
        [TO, "5.5"],
      ],
      [txn("u", "2026-02-02", "buy", "3", "100", "USD")],
    );
    expect(attribution(noPrice, "u", FROM, TO)).toMatchObject({
      rNative: null,
      rBase: null,
      rFx: null,
      reason: "no_price",
      boundaries: [],
    });
    // Two days past the only price under the 7-day calendar's 1-day window.
    const stalePrice = usdInput(
      [price("u", FROM, "100", "USD")],
      [
        [FROM, "5"],
        [TO, "5.5"],
      ],
      [txn("u", "2026-02-02", "buy", "3", "100", "USD")],
    );
    expect(attribution(stalePrice, "u", FROM, TO).reason).toBe("stale");
    const staleFx = usdInput(
      [price("u", FROM, "100", "USD"), price("u", TO, "110", "USD")],
      [[FROM, "5"]],
      [txn("u", "2026-02-02", "buy", "3", "100", "USD")],
    );
    expect(attribution(staleFx, "u", FROM, TO).reason).toBe("stale");
    const never = usdInput(
      [price("u", FROM, "100", "USD"), price("u", TO, "110", "USD")],
      [
        [FROM, "5"],
        [TO, "5.5"],
      ],
      [txn("u", TO, "buy", "3", "100", "USD")],
    );
    expect(attribution(never, "u", FROM, TO).reason).toBe("no_position");
    expect(() => attribution(never, "nope", FROM, TO)).toThrow(/invalid_input/);
    expect(() => attribution(never, "u", TO, FROM)).toThrow(/invalid_input/);
  });

  const px = fc.integer({ min: 100, max: 100000 }).map((n) => new KernelDecimal(n).div(100).toFixed());
  const fx = fc.integer({ min: 100, max: 1000 }).map((n) => new KernelDecimal(n).div(100).toFixed());

  it("property: with constant quantity, R_fx equals the FX series return and the identity holds exactly", () => {
    fc.assert(
      fc.property(px, px, fx, fx, fc.integer({ min: 1, max: 999 }), (p0, p1, f0, f1, q) => {
        const input = usdInput(
          [price("u", FROM, p0, "USD"), price("u", TO, p1, "USD")],
          [
            [FROM, f0],
            [TO, f1],
          ],
          [txn("u", "2026-02-02", "buy", String(q), p0, "USD")],
        );
        const r = attribution(input, "u", FROM, TO);
        if (r.rFx === null || r.rBase === null || r.rNative === null) throw new Error(r.reason);
        const fxReturn = new KernelDecimal(f1).div(f0).minus(ONE);
        expect(r.rFx.minus(fxReturn).abs().lt("1e-36")).toBe(true);
        expect(
          ONE.plus(r.rBase)
            .minus(ONE.plus(r.rNative).times(ONE.plus(r.rFx)))
            .abs()
            .lt("1e-36"),
        ).toBe(true);
      }),
    );
  });
});
