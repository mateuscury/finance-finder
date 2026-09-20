import { describe, expect, it } from "vitest";
import { KernelDecimal } from "../decimal";
import { buildMarketData } from "../types";
import { fxRateAt } from "./fx-rate";

describe("fxRateAt", () => {
  it("resolves the latest observation with the asset's window", () => {
    const md = buildMarketData([], [{ seriesId: "global.usdbrl", date: "2026-02-13", value: "5.1234", tenorDays: 0 }]);
    expect(fxRateAt(md, "global.usdbrl", "2026-02-13", 5)).toEqual({ status: "ok", value: new KernelDecimal("5.1234"), observedOn: "2026-02-13" });
    expect(fxRateAt(md, "global.usdbrl", "2026-02-18", 5).status).toBe("carried_forward");
    expect(fxRateAt(md, "global.usdbrl", "2026-02-19", 5).status).toBe("stale");
    expect(fxRateAt(md, "global.usdbrl", "2026-02-12", 5)).toEqual({ status: "unpriced", reason: "no_observation" });
  });
});
