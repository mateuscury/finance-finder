import { describe, expect, it } from "vitest";
import { KernelDecimal } from "./decimal";
import { realReturn } from "./real";
import { buildMarketData } from "./types";
import { CDI, IPCA, pt } from "./valuation/testkit";

const market = buildMarketData([], [pt("br.ipca", "2026-01-31", "100"), pt("br.ipca", "2026-02-28", "105")]);

describe("realReturn", () => {
  it("deflates a nominal return by the index ratio", () => {
    const r = realReturn(new KernelDecimal("0.1"), market, IPCA, "2026-01-31", "2026-02-28");
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.value.minus(new KernelDecimal("1.1").div("1.05").minus(1)).abs().lt("1e-38")).toBe(true);
    expect(r.observedOn).toBe("2026-02-28");
  });

  it("takes the worse leg's status and propagates unpriced", () => {
    expect(realReturn(new KernelDecimal("0.1"), market, IPCA, "2026-01-31", "2026-03-20")).toMatchObject({ status: "carried_forward", observedOn: "2026-02-28" });
    expect(realReturn(new KernelDecimal("0.1"), market, IPCA, "2026-01-31", "2026-06-01").status).toBe("stale");
    expect(realReturn(new KernelDecimal("0.1"), market, IPCA, "2026-01-01", "2026-02-28")).toEqual({ status: "unpriced", reason: "before_first_anchor" });
  });

  it("refuses a series that is not an inflation index", () => {
    expect(() => realReturn(new KernelDecimal("0.1"), market, CDI, "2026-01-31", "2026-02-28")).toThrow(/unsupported_convention/);
  });
});
