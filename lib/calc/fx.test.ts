import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SeriesDescriptor } from "@/packs/types";
import { KernelDecimal, ONE } from "./decimal";
import { addDays } from "./dates";
import { resolveFx } from "./fx";
import { buildMarketData, type SeriesObservation } from "./types";

function fx(id: string, base: string, quote: string): SeriesDescriptor {
  return { id, label: id, kind: { kind: "fx_rate", base, quote }, sourceId: "global.test", roles: ["fx"] };
}
const pt = (seriesId: string, date: string, value: string): SeriesObservation => ({
  seriesId,
  date,
  value,
  tenorDays: 0,
});

const USDBRL = fx("global.usdbrl", "USD", "BRL");
const EURUSD = fx("global.eurusd", "EUR", "USD");
const W = 5;

describe("resolveFx", () => {
  it("same currency is rate 1, not derived, no date", () => {
    const md = buildMarketData([], []);
    expect(resolveFx(md, [], "BRL", "BRL", "2026-02-13", W)).toEqual({
      status: "ok",
      rate: ONE,
      derived: false,
      fxDate: null,
    });
  });

  it("multiplies with a direct series and divides with an inverted one", () => {
    const md = buildMarketData([], [pt("global.usdbrl", "2026-02-13", "5")]);
    expect(resolveFx(md, [USDBRL], "USD", "BRL", "2026-02-13", W)).toEqual({
      status: "ok",
      rate: new KernelDecimal("5"),
      derived: false,
      fxDate: "2026-02-13",
    });
    expect(resolveFx(md, [USDBRL], "BRL", "USD", "2026-02-13", W)).toEqual({
      status: "ok",
      rate: new KernelDecimal("0.2"),
      derived: false,
      fxDate: "2026-02-13",
    });
  });

  it("carries forward within the window, is stale beyond, unpriced with no series", () => {
    const md = buildMarketData([], [pt("global.usdbrl", "2026-02-13", "5")]);
    expect(resolveFx(md, [USDBRL], "USD", "BRL", "2026-02-18", W)).toEqual({
      status: "carried_forward",
      rate: new KernelDecimal("5"),
      derived: false,
      fxDate: "2026-02-13",
    });
    expect(resolveFx(md, [USDBRL], "USD", "BRL", "2026-02-19", W)).toEqual({
      status: "stale",
      lastKnown: new KernelDecimal("5"),
      derived: false,
      fxDate: "2026-02-13",
    });
    expect(resolveFx(md, [USDBRL], "USD", "BRL", "2026-02-12", W)).toEqual({
      status: "unpriced",
      reason: "no_fx_series",
    });
    expect(resolveFx(md, [], "USD", "BRL", "2026-02-13", W)).toEqual({ status: "unpriced", reason: "no_fx_series" });
    expect(resolveFx(md, [USDBRL], "GBP", "BRL", "2026-02-13", W)).toEqual({
      status: "unpriced",
      reason: "no_fx_series",
    });
  });

  it("triangulates through USD, marks it derived, and dates it by the oldest leg", () => {
    const md = buildMarketData([], [pt("global.usdbrl", "2026-02-13", "5"), pt("global.eurusd", "2026-02-11", "1.1")]);
    const r = resolveFx(md, [USDBRL, EURUSD], "EUR", "BRL", "2026-02-13", W);
    expect(r).toEqual({
      status: "carried_forward",
      rate: new KernelDecimal("5.5"),
      derived: true,
      fxDate: "2026-02-11",
    });
    // Reverse direction inverts both legs.
    const back = resolveFx(md, [USDBRL, EURUSD], "BRL", "EUR", "2026-02-13", W);
    expect(back.status).toBe("carried_forward");
    if (back.status === "carried_forward") expect(back.rate.minus(ONE.div("5.5")).abs().lt("1e-38")).toBe(true);
    // One stale leg makes the whole result stale.
    const later = resolveFx(md, [USDBRL, EURUSD], "EUR", "BRL", "2026-02-17", W);
    expect(later).toEqual({
      status: "stale",
      lastKnown: new KernelDecimal("5.5"),
      derived: true,
      fxDate: "2026-02-11",
    });
    // USD itself never triangulates through USD.
    expect(resolveFx(md, [EURUSD], "USD", "BRL", "2026-02-13", W)).toEqual({
      status: "unpriced",
      reason: "no_fx_series",
    });
  });

  const rate = fc.stringMatching(/^[1-9]\d{0,2}\.\d{1,6}$/);

  it("property: direct and inverted series agree to 1e-30", () => {
    fc.assert(
      fc.property(rate, (r) => {
        const inverse = ONE.div(r).toFixed();
        const direct = buildMarketData([], [pt("global.usdbrl", "2026-02-13", r)]);
        const inverted = buildMarketData([], [pt("global.brlusd", "2026-02-13", inverse)]);
        const a = resolveFx(direct, [USDBRL], "USD", "BRL", "2026-02-13", W);
        const b = resolveFx(inverted, [fx("global.brlusd", "BRL", "USD")], "USD", "BRL", "2026-02-13", W);
        if (a.status !== "ok" || b.status !== "ok") throw new Error("expected ok");
        expect(a.rate.minus(b.rate).abs().lt("1e-30")).toBe(true);
      }),
    );
  });

  it("property: triangulation through consistent synthetic legs reproduces the direct rate", () => {
    fc.assert(
      fc.property(rate, rate, (eurusd, usdbrl) => {
        const eurbrl = new KernelDecimal(eurusd).times(usdbrl).toFixed();
        const md = buildMarketData(
          [],
          [
            pt("global.eurusd", "2026-02-13", eurusd),
            pt("global.usdbrl", "2026-02-13", usdbrl),
            pt("global.eurbrl", "2026-02-13", eurbrl),
          ],
        );
        const viaUsd = resolveFx(md, [EURUSD, USDBRL], "EUR", "BRL", "2026-02-13", W);
        const direct = resolveFx(md, [fx("global.eurbrl", "EUR", "BRL")], "EUR", "BRL", "2026-02-13", W);
        if (viaUsd.status !== "ok" || direct.status !== "ok") throw new Error("expected ok");
        expect(viaUsd.derived).toBe(true);
        expect(direct.derived).toBe(false);
        expect(viaUsd.rate.minus(direct.rate).abs().lt("1e-30")).toBe(true);
      }),
    );
  });

  it("property: carry-forward respects the window exactly at the boundary day", () => {
    const day = fc.integer({ min: 0, max: 400 }).map((n) => addDays("2025-06-01", n));
    fc.assert(
      fc.property(day, fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 40 }), (observedOn, window, age) => {
        const md = buildMarketData([], [pt("global.usdbrl", observedOn, "5")]);
        const r = resolveFx(md, [USDBRL], "USD", "BRL", addDays(observedOn, age), window);
        expect(r.status).toBe(age === 0 ? "ok" : age <= window ? "carried_forward" : "stale");
      }),
    );
  });
});
