import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { brCalendar } from "@/packs/br/calendar";
import type { AccrualConvention, DayCount, SeriesDescriptor } from "@/packs/types";
import { KernelDecimal, ONE } from "../decimal";
import { addDays } from "../dates";
import { isKernelError } from "../errors";
import { buildMarketData } from "../types";
import { valueAccrual } from "./accrual";
import type { ValuationContext } from "./result";
import { asset, CDI, constantCdi, IBOV, IPCA, kind, lot, near, pt, sevenDay, money } from "./testkit";

const market = buildMarketData(
  [],
  [
    ...constantCdi(brCalendar, "2026-01-02", "2026-04-30", "0.0005"),
    pt("br.ipca", "2026-01-31", "100"),
    pt("br.ipca", "2026-02-28", "101"),
    pt("br.ibovespa", "2026-02-02", "120000"),
    pt("br.ibovespa", "2026-02-13", "126000"),
  ],
);
const series = [CDI, IPCA, IBOV];
const br: ValuationContext = { market, calendar: brCalendar, windowDays: 5, series };
const open: ValuationContext = { ...br, calendar: sevenDay, windowDays: 1 };

function accrual(convention: AccrualConvention) {
  return kind(`zz.${convention.compounding}.${convention.dayCount}.${convention.index?.mode ?? "plain"}`, { kind: "accrual", convention });
}
const plainDaily = accrual({ dayCount: "BUS/252", compounding: "daily" });
const pctCdi = accrual({ dayCount: "BUS/252", compounding: "daily", index: { mode: "percent_of_index", seriesId: "br.cdi" } });
const ipcaPlus = accrual({ dayCount: "BUS/252", compounding: "daily", index: { mode: "index_plus_spread", seriesId: "br.ipca" } });

// Mon 2 Feb → Fri 13 Feb 2026: 3,4,5,6,9,10,11,12,13 = nine business days.
const NINE = new KernelDecimal(9).div(252);

describe("plain fixed rate", () => {
  it("daily BUS/252: (1 + rate)^(businessDays / 252) per lot; today's deposit is worth its principal", () => {
    const a = asset("cdb", plainDaily, { rate: "0.12" });
    const today = valueAccrual(a, [lot("2026-02-02", "1", "10000")], "2026-02-02", br);
    expect(today).toMatchObject({ status: "ok", priceDate: "2026-02-02" });
    if (today.status === "ok") expect(money(today.native)).toBe("BRL 10000");

    const later = valueAccrual(a, [lot("2026-02-02", "1", "10000")], "2026-02-13", br);
    if (later.status !== "ok") throw new Error(later.status);
    const expected = new KernelDecimal("10000").times(new KernelDecimal("1.12").pow(NINE));
    expect(near(later.native.amount, expected)).toBe(true);
    expect(near(later.unitValue, expected)).toBe(true);
  });

  it("daily ACT/365 over exactly one year is exactly (1 + rate)", () => {
    const a = asset("cdb", accrual({ dayCount: "ACT/365", compounding: "daily" }), { rate: "0.12" });
    const r = valueAccrual(a, [lot("2025-01-01", "10000", "1")], "2026-01-01", open);
    if (r.status !== "ok") throw new Error(r.status);
    expect(money(r.native)).toBe("BRL 11200");
    expect(r.unitValue.toFixed()).toBe("1.12");
  });

  it("monthly steps on each monthly anniversary of the lot", () => {
    const a = asset("cdb", accrual({ dayCount: "BUS/252", compounding: "monthly" }), { rate: "0.12" });
    const at = (asOf: string) => {
      const r = valueAccrual(a, [lot("2026-01-15", "1", "1000")], asOf, br);
      if (r.status !== "ok") throw new Error(r.status);
      return r.native.amount;
    };
    expect(at("2026-02-14").toFixed()).toBe("1000");
    expect(near(at("2026-02-15"), new KernelDecimal("1000").times(new KernelDecimal("1.12").pow(ONE.div(12))))).toBe(true);
    expect(near(at("2026-03-14"), new KernelDecimal("1000").times(new KernelDecimal("1.12").pow(ONE.div(12))))).toBe(true);
    expect(near(at("2026-03-15"), new KernelDecimal("1000").times(new KernelDecimal("1.12").pow(new KernelDecimal(2).div(12))))).toBe(true);
  });

  it("annual steps on each yearly anniversary", () => {
    const a = asset("bond", accrual({ dayCount: "ACT/365", compounding: "annual" }), { rate: "0.12" });
    const at = (asOf: string) => {
      const r = valueAccrual(a, [lot("2025-01-15", "1", "1000")], asOf, open);
      if (r.status !== "ok") throw new Error(r.status);
      return r.native.amount.toFixed();
    };
    expect(at("2026-01-14")).toBe("1000");
    expect(at("2026-01-15")).toBe("1120");
    expect(at("2027-01-14")).toBe("1120");
    expect(at("2027-01-15")).toBe("1254.4");
  });

  it("sums lots opened on different dates and reports the average unit value", () => {
    const a = asset("cdb", accrual({ dayCount: "ACT/365", compounding: "daily" }), { rate: "0.12" });
    const r = valueAccrual(a, [lot("2025-01-01", "1000", "1"), lot("2026-01-01", "500", "1")], "2026-01-01", open);
    if (r.status !== "ok") throw new Error(r.status);
    // 1000 × 1.12 + 500 × 1 = 1620 over 1500 units.
    expect(money(r.native)).toBe("BRL 1620");
    expect(r.unitValue.toFixed()).toBe("1.08");
  });
});

describe("percent_of_index", () => {
  it("compounds each business day's rate × multiplier — the CETIP convention", () => {
    const a = asset("cdb", pctCdi, { rate: "1.10" });
    const r = valueAccrual(a, [lot("2026-02-02", "1", "10000")], "2026-02-13", br);
    if (r.status !== "ok") throw new Error(r.status);
    const expected = new KernelDecimal("10000").times(new KernelDecimal("1.00055").pow(9));
    expect(near(r.native.amount, expected)).toBe(true);
    expect(r.priceDate).toBe("2026-02-13");
  });

  it("a day without a published rate is unpriced with series_gap, never carried forward", () => {
    const a = asset("cdb", pctCdi, { rate: "1.10" });
    expect(valueAccrual(a, [lot("2026-04-29", "1", "10000")], "2026-05-04", br)).toEqual({ status: "unpriced", reason: "series_gap" });
  });
});

describe("index_plus_spread", () => {
  it("level ratio × (1 + spread)^τ with linear_daily interpolation on both legs", () => {
    const a = asset("cdb", ipcaPlus, { rate: "0.06" });
    const r = valueAccrual(a, [lot("2026-02-02", "1", "10000")], "2026-02-13", br);
    if (r.status !== "ok") throw new Error(r.status);
    // Anchors 31 Jan = 100, 28 Feb = 101: 2 Feb = 100 + 2/28, 13 Feb = 100 + 13/28.
    const start = new KernelDecimal(100).plus(new KernelDecimal(2).div(28));
    const end = new KernelDecimal(100).plus(new KernelDecimal(13).div(28));
    const expected = new KernelDecimal("10000").times(end.div(start)).times(new KernelDecimal("1.06").pow(NINE));
    expect(near(r.native.amount, expected)).toBe(true);
    expect(r.priceDate).toBe("2026-02-13");
  });

  it("is carried forward after the last anchor and unpriced before the first", () => {
    const a = asset("cdb", ipcaPlus, { rate: "0.06" });
    expect(valueAccrual(a, [lot("2026-02-02", "1", "10000")], "2026-03-10", br)).toMatchObject({ status: "carried_forward", priceDate: "2026-02-28" });
    expect(valueAccrual(a, [lot("2026-01-15", "1", "10000")], "2026-02-13", br)).toEqual({ status: "unpriced", reason: "before_first_anchor" });
  });

  it("accepts an index_level series, carried forward within the window", () => {
    const ibovPlus = accrual({ dayCount: "BUS/252", compounding: "daily", index: { mode: "index_plus_spread", seriesId: "br.ibovespa" } });
    const a = asset("note", ibovPlus, { rate: "0" });
    const r = valueAccrual(a, [lot("2026-02-02", "1", "1000")], "2026-02-13", br);
    if (r.status !== "ok") throw new Error(r.status);
    expect(money(r.native)).toBe("BRL 1050");
    expect(valueAccrual(a, [lot("2026-02-02", "1", "1000")], "2026-02-16", br)).toMatchObject({ status: "carried_forward", priceDate: "2026-02-13" });
  });
});

describe("contract", () => {
  it("metadata without a rate is unpriced with invalid_metadata, never a throw", () => {
    expect(valueAccrual(asset("cdb", plainDaily, {}), [lot("2026-02-02", "1", "1")], "2026-02-13", br)).toEqual({ status: "unpriced", reason: "invalid_metadata" });
    expect(valueAccrual(asset("cdb", plainDaily, { rate: "12%" }), [lot("2026-02-02", "1", "1")], "2026-02-13", br)).toEqual({ status: "unpriced", reason: "invalid_metadata" });
  });

  it("maturity is never read: a lot keeps accruing past it", () => {
    const a = asset("cdb", accrual({ dayCount: "ACT/365", compounding: "daily" }), { rate: "0.12", maturity: "2025-06-30" });
    const r = valueAccrual(a, [lot("2025-01-01", "1", "1000")], "2026-01-01", open);
    if (r.status !== "ok") throw new Error(r.status);
    expect(money(r.native)).toBe("BRL 1120");
  });

  it("a lot in another currency is currency_mismatch; an unknown index series is invalid_input", () => {
    expect(() => valueAccrual(asset("cdb", plainDaily, { rate: "0.1" }), [lot("2026-02-02", "1", "1", "USD")], "2026-02-13", br)).toThrow(/currency_mismatch/);
    const orphan = accrual({ dayCount: "BUS/252", compounding: "daily", index: { mode: "percent_of_index", seriesId: "br.nope" } });
    expect(() => valueAccrual(asset("cdb", orphan, { rate: "1" }), [lot("2026-02-02", "1", "1")], "2026-02-13", br)).toThrow(/invalid_input/);
  });

  const dayCounts: DayCount[] = ["BUS/252", "ACT/365", "ACT/360", "30/360"];
  const granularities = ["daily", "monthly", "annual"] as const;

  it.each(dayCounts)("plain accepts every granularity under %s", (dayCount) => {
    for (const compounding of granularities) {
      const a = asset("x", accrual({ dayCount, compounding }), { rate: "0.1" });
      expect(valueAccrual(a, [lot("2026-02-02", "1", "1")], "2026-02-13", br).status).toBe("ok");
    }
  });

  it.each(dayCounts)("percent_of_index accepts only daily with a matching day count under %s", (dayCount) => {
    for (const compounding of granularities) {
      const a = asset("x", accrual({ dayCount, compounding, index: { mode: "percent_of_index", seriesId: "br.cdi" } }), { rate: "1" });
      const run = () => valueAccrual(a, [lot("2026-02-02", "1", "1")], "2026-02-13", br);
      if (compounding === "daily" && dayCount === "BUS/252") expect(run().status).toBe("ok");
      else expect(run).toThrow(/unsupported_convention/);
    }
  });

  it.each(dayCounts)("index_plus_spread accepts every granularity under %s", (dayCount) => {
    for (const compounding of granularities) {
      const a = asset("x", accrual({ dayCount, compounding, index: { mode: "index_plus_spread", seriesId: "br.ipca" } }), { rate: "0.06" });
      expect(valueAccrual(a, [lot("2026-02-02", "1", "1")], "2026-02-13", br).status).toBe("ok");
    }
  });

  it("refuses the wrong series kind for each indexed mode", () => {
    const pctIpca = accrual({ dayCount: "BUS/252", compounding: "daily", index: { mode: "percent_of_index", seriesId: "br.ipca" } });
    const cdiPlus = accrual({ dayCount: "BUS/252", compounding: "daily", index: { mode: "index_plus_spread", seriesId: "br.cdi" } });
    expect(() => valueAccrual(asset("x", pctIpca, { rate: "1" }), [lot("2026-02-02", "1", "1")], "2026-02-13", br)).toThrow(/unsupported_convention/);
    expect(() => valueAccrual(asset("x", cdiPlus, { rate: "0" }), [lot("2026-02-02", "1", "1")], "2026-02-13", br)).toThrow(/unsupported_convention/);
    try {
      valueAccrual(asset("x", pctIpca, { rate: "1" }), [lot("2026-02-02", "1", "1")], "2026-02-13", br);
    } catch (err) {
      expect(isKernelError(err, "unsupported_convention")).toBe(true);
    }
  });

  const dayIn = fc.integer({ min: 0, max: 80 }).map((n) => addDays("2026-02-02", n));
  const modes: SeriesDescriptor["id"][] = ["plain", "br.cdi", "br.ipca"];

  it("property: a lot opened on the valuation date is worth exactly its principal in every mode", () => {
    fc.assert(
      fc.property(dayIn, fc.constantFrom(...modes), fc.integer({ min: 1, max: 999999 }), (day, mode, principal) => {
        const k = mode === "plain" ? plainDaily : mode === "br.cdi" ? pctCdi : ipcaPlus;
        const a = asset("x", k, { rate: mode === "br.cdi" ? "1.10" : "0.12" });
        const r = valueAccrual(a, [lot(day, "1", String(principal))], day, br);
        if (r.status === "unpriced") {
          // Only the inflation leg can be unpriced here, and only after its 62-day carry.
          expect(mode).toBe("br.ipca");
          return;
        }
        if (r.status === "stale") throw new Error("unexpected stale");
        expect(r.native.amount.toFixed()).toBe(String(principal));
      }),
    );
  });
});
