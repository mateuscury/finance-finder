import { describe, expect, it } from "vitest";
import { FetchPointSchema, SeriesKindSchema } from "./schema";

describe("pack boundary schemas", () => {
  it("accepts exact decimal strings and an optional positive curve tenor", () => {
    expect(
      FetchPointSchema.safeParse({
        // A hypothetical curve series: no in-repo pack declares one since
        // br.tesouro_direto moved to nav_unit_price (MILESTONES.md decision 2).
        ref: "uk.gilt_curve",
        date: "2026-09-04",
        value: "0.1425",
        currency: null,
        tenorDays: 252,
      }).success,
    ).toBe(true);
  });

  it.each([
    { ref: "br.cdi", date: "2026-09-04", value: "NaN", currency: null },
    { ref: "br.cdi", date: "2026-09-04", value: "1e-3", currency: null },
    { ref: "uk.gilt_curve", date: "2026-09-04", value: "0.14", currency: null, tenorDays: 0 },
  ])("rejects an unsafe point: %o", (point) => {
    expect(FetchPointSchema.safeParse(point).success).toBe(false);
  });

  it("rejects duplicate yield-curve tenors", () => {
    expect(SeriesKindSchema.safeParse({ kind: "yield_curve", tenors: [21, 252, 252] }).success).toBe(false);
  });
});

