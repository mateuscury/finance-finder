import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { brCalendar } from "@/packs/br/calendar";
import type { SeriesDescriptor } from "@/packs/types";
import { KernelDecimal, ONE } from "./decimal";
import { addDays } from "./dates";
import { isBusinessDay } from "./calendar";
import { isKernelError } from "./errors";
import { indexReturn } from "./series";
import { buildMarketData } from "./types";
import { seriesReturn } from "./benchmark";
import { CDI, IPCA, IBOV, constantCdi, pt, near } from "./valuation/testkit";

const USDBRL: SeriesDescriptor = {
  id: "global.usdbrl",
  label: "USD/BRL",
  kind: { kind: "fx_rate", base: "USD", quote: "BRL" },
  sourceId: "global.bcb_ptax",
  roles: ["fx"],
};
const CURVE: SeriesDescriptor = {
  id: "zz.curve",
  label: "curve",
  kind: { kind: "yield_curve", tenors: [365] },
  sourceId: "zz.src",
  roles: ["discount_curve"],
};

const market = buildMarketData(
  [],
  [
    ...constantCdi(brCalendar, "2026-01-02", "2026-03-31", "0.0005"),
    pt("br.ipca", "2026-01-31", "100"),
    pt("br.ipca", "2026-02-28", "101"),
    pt("br.ibovespa", "2026-02-02", "120000"),
    pt("br.ibovespa", "2026-02-13", "126000"),
    pt("global.usdbrl", "2026-02-02", "5.00"),
    pt("global.usdbrl", "2026-02-13", "5.25"),
  ],
);
const ctx = { calendar: brCalendar, windowDays: 5 };

describe("seriesReturn (decision 37)", () => {
  it("index_level is exactly indexReturn", () => {
    const r = seriesReturn(IBOV, market, "2026-02-02", "2026-02-13", ctx);
    const direct = indexReturn(market, "br.ibovespa", "2026-02-02", "2026-02-13", 5);
    expect(r).toEqual(direct);
    if (r.status !== "ok") throw new Error(r.status);
    expect(near(r.value, new KernelDecimal("0.05"))).toBe(true);
  });

  it("a constant daily rate over n business days is (1 + r)^n − 1", () => {
    // Mon 2 Feb → Fri 13 Feb 2026: nine business days in (from, to].
    const r = seriesReturn(CDI, market, "2026-02-02", "2026-02-13", ctx);
    if (r.status !== "ok") throw new Error(r.status);
    expect(near(r.value, new KernelDecimal("1.0005").pow(9).minus(1))).toBe(true);
    expect(r.observedOn).toBe("2026-02-13");
  });

  it("property: a constant rate_daily r over any window equals (1 + r)^n − 1 within 1e-30", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 15 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 1, max: 30 }),
        (rateBp, startOffset, span) => {
          const rate = new KernelDecimal(rateBp).div(10000).toFixed();
          const from = addDays("2026-01-02", startOffset);
          const to = addDays(from, span);
          const m = buildMarketData([], constantCdi(brCalendar, "2026-01-02", "2026-03-31", rate));
          const r = seriesReturn(CDI, m, from, to, ctx);
          if (r.status !== "ok") throw new Error(r.status);
          let n = 0;
          for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isBusinessDay(brCalendar, d)) n += 1;
          const expected = ONE.plus(rate).pow(n).minus(ONE);
          expect(r.value.minus(expected).abs().lt("1e-30")).toBe(true);
        },
      ),
    );
  });

  it("inflation_index is the interpolated level ratio − 1, and fx_rate the rate ratio − 1", () => {
    const i = seriesReturn(IPCA, market, "2026-02-02", "2026-02-13", ctx);
    if (i.status !== "ok") throw new Error(i.status);
    const start = new KernelDecimal(100).plus(new KernelDecimal(2).div(28));
    const end = new KernelDecimal(100).plus(new KernelDecimal(13).div(28));
    expect(near(i.value, end.div(start).minus(1))).toBe(true);
    const f = seriesReturn(USDBRL, market, "2026-02-02", "2026-02-13", ctx);
    if (f.status !== "ok") throw new Error(f.status);
    expect(near(f.value, new KernelDecimal("0.05"))).toBe(true);
  });

  it("propagates the worse status: a stale end is stale with the last known rate; a gap is unpriced", () => {
    const stale = seriesReturn(IBOV, market, "2026-02-02", "2026-03-31", ctx);
    expect(stale.status).toBe("stale");
    if (stale.status === "stale") expect(near(stale.lastKnown, new KernelDecimal("0.05"))).toBe(true);
    const gap = seriesReturn(CDI, market, "2026-02-02", "2026-04-30", ctx);
    expect(gap).toEqual({ status: "unpriced", reason: "series_gap" });
  });

  it("a yield curve has no single return; from > to is a contract violation", () => {
    expect(seriesReturn(CURVE, market, "2026-02-02", "2026-02-13", ctx)).toEqual({
      status: "unpriced",
      reason: "not_a_return_series",
    });
    try {
      seriesReturn(IBOV, market, "2026-02-13", "2026-02-02", ctx);
      throw new Error("no throw");
    } catch (e) {
      expect(isKernelError(e) && e.code).toBe("invalid_input");
    }
  });
});
