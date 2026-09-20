import { describe, expect, it } from "vitest";
import { KernelDecimal } from "../decimal";
import { buildMarketData, type SeriesObservation } from "../types";
import { indexReturn, levelAt } from "./index-level";

const pt = (date: string, value: string): SeriesObservation => ({ seriesId: "br.ibov", date, value, tenorDays: 0 });
const md = buildMarketData([], [pt("2026-02-10", "100000"), pt("2026-02-11", "101000"), pt("2026-02-13", "102000"), pt("2026-03-02", "99000")]);
const W = 5;

describe("levelAt", () => {
  it("is fresh on the day, carried forward within the window, stale beyond, unpriced before the first point", () => {
    expect(levelAt(md, "br.ibov", "2026-02-11", W)).toEqual({ status: "ok", value: new KernelDecimal("101000"), observedOn: "2026-02-11" });
    expect(levelAt(md, "br.ibov", "2026-02-18", W)).toEqual({ status: "carried_forward", value: new KernelDecimal("102000"), observedOn: "2026-02-13" });
    expect(levelAt(md, "br.ibov", "2026-02-19", W)).toEqual({ status: "stale", lastKnown: new KernelDecimal("102000"), observedOn: "2026-02-13" });
    expect(levelAt(md, "br.ibov", "2026-02-09", W)).toEqual({ status: "unpriced", reason: "no_observation" });
    expect(levelAt(md, "br.nope", "2026-02-11", W)).toEqual({ status: "unpriced", reason: "no_observation" });
  });
});

describe("indexReturn", () => {
  it("is level(to) / level(from) − 1 and reports the worse leg's status", () => {
    const ok = indexReturn(md, "br.ibov", "2026-02-10", "2026-02-13", W);
    expect(ok).toEqual({ status: "ok", value: new KernelDecimal("0.02"), observedOn: "2026-02-13" });
    // `to` on 18 Feb carries the 13 Feb level (age 5).
    const carried = indexReturn(md, "br.ibov", "2026-02-10", "2026-02-18", W);
    expect(carried).toEqual({ status: "carried_forward", value: new KernelDecimal("0.02"), observedOn: "2026-02-13" });
    // `from` on 19 Feb is stale even though `to` is fresh on 2 Mar.
    const stale = indexReturn(md, "br.ibov", "2026-02-19", "2026-03-02", W);
    expect(stale.status).toBe("stale");
    if (stale.status === "stale") {
      expect(stale.lastKnown.toFixed(10)).toBe(new KernelDecimal("99000").div("102000").minus(1).toFixed(10));
      expect(stale.observedOn).toBe("2026-03-02");
    }
    expect(indexReturn(md, "br.ibov", "2026-02-01", "2026-02-13", W)).toEqual({ status: "unpriced", reason: "no_observation" });
  });
});
