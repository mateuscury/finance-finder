import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isKernelError } from "./errors";
import { buildMarketData, type PriceObservation, type SeriesObservation } from "./types";

const price = (date: string, price: string, assetId = "a1"): PriceObservation => ({
  assetId,
  date,
  price,
  currency: "BRL",
  sourceId: "manual",
});
const point = (date: string, value: string, tenorDays = 0, seriesId = "br.cdi"): SeriesObservation => ({
  seriesId,
  date,
  value,
  tenorDays,
});

describe("buildMarketData", () => {
  it("validates every observation on the way in", () => {
    expect(() => buildMarketData([price("2026-02-30", "1")], [])).toThrow();
    expect(() => buildMarketData([price("2026-02-10", "1e3")], [])).toThrow();
    expect(() => buildMarketData([], [point("2026-02-10", "0.1", -1)])).toThrow();
    expect(() => buildMarketData([], [point("2026-02-10", "0.1", 1.5)])).toThrow();
    try {
      buildMarketData([price("2026-02-10", "1.0.0")], []);
    } catch (err) {
      expect(isKernelError(err, "invalid_decimal")).toBe(true);
      expect((err as Error).message).not.toContain("1.0.0");
    }
  });

  it("rejects duplicate keys and names the coordinates, never the value", () => {
    try {
      buildMarketData([price("2026-02-10", "1"), price("2026-02-10", "2")], []);
      expect.unreachable();
    } catch (err) {
      expect(isKernelError(err, "invalid_input")).toBe(true);
      expect((err as Error & { details: Record<string, unknown> }).details).toEqual({ assetId: "a1", date: "2026-02-10" });
    }
    expect(() => buildMarketData([], [point("2026-02-10", "1", 30), point("2026-02-10", "2", 30)])).toThrow();
    // Same date, different tenor is a curve, not a duplicate.
    expect(() => buildMarketData([], [point("2026-02-10", "1", 30), point("2026-02-10", "2", 90)])).not.toThrow();
  });

  it("sorts ascending whatever the input order and answers latest-at-or-before", () => {
    const md = buildMarketData(
      [price("2026-02-13", "3"), price("2026-02-10", "1"), price("2026-02-11", "2")],
      [point("2026-02-12", "0.3"), point("2026-02-10", "0.1")],
    );
    expect(md.pricesFor("a1").map((p) => p.date)).toEqual(["2026-02-10", "2026-02-11", "2026-02-13"]);
    expect(md.latestPriceAtOrBefore("a1", "2026-02-09")).toBeNull();
    expect(md.latestPriceAtOrBefore("a1", "2026-02-10")?.price).toBe("1");
    expect(md.latestPriceAtOrBefore("a1", "2026-02-12")?.price).toBe("2");
    expect(md.latestPriceAtOrBefore("a1", "2026-12-31")?.price).toBe("3");
    expect(md.latestPriceAtOrBefore("nope", "2026-12-31")).toBeNull();
    expect(md.pricesFor("nope")).toEqual([]);

    expect(md.latestDateAtOrBefore("br.cdi", "2026-02-11")).toBe("2026-02-10");
    expect(md.latestDateAtOrBefore("br.cdi", "2026-02-09")).toBeNull();
    expect(md.latestScalarAtOrBefore("br.cdi", "2026-02-12")?.value).toBe("0.3");
    expect(md.pointsOn("br.cdi", "2026-02-12").map((p) => p.value)).toEqual(["0.3"]);
    expect(md.pointsOn("br.cdi", "2026-02-11")).toEqual([]);
    expect(md.seriesFor("nope")).toEqual([]);
  });

  it("keeps a yield curve's tenors together per date and finds no scalar in it", () => {
    const md = buildMarketData(
      [],
      [point("2026-02-10", "0.12", 365, "br.di"), point("2026-02-10", "0.11", 30, "br.di"), point("2026-02-09", "0.10", 30, "br.di")],
    );
    expect(md.seriesFor("br.di").map((p) => [p.date, p.tenorDays])).toEqual([
      ["2026-02-09", 30],
      ["2026-02-10", 30],
      ["2026-02-10", 365],
    ]);
    expect(md.pointsOn("br.di", "2026-02-10").map((p) => p.tenorDays)).toEqual([30, 365]);
    expect(md.latestDateAtOrBefore("br.di", "2026-03-01")).toBe("2026-02-10");
    expect(md.latestScalarAtOrBefore("br.di", "2026-03-01")).toBeNull();
  });

  it("returns frozen arrays", () => {
    const md = buildMarketData([price("2026-02-10", "1")], [point("2026-02-10", "0.1")]);
    expect(Object.isFrozen(md.pricesFor("a1"))).toBe(true);
    expect(Object.isFrozen(md.seriesFor("br.cdi"))).toBe(true);
    expect(Object.isFrozen(md.pricesFor("nope"))).toBe(true);
  });

  it("property: latestPriceAtOrBefore agrees with a linear scan over any set of distinct dates", () => {
    const day = fc.integer({ min: 0, max: 400 }).map((n) => {
      const d = new Date(Date.UTC(2026, 0, 1 + n));
      return d.toISOString().slice(0, 10);
    });
    fc.assert(
      fc.property(fc.uniqueArray(day, { minLength: 0, maxLength: 40 }), day, (dates, asOf) => {
        const rows = dates.map((d, i) => price(d, String(i + 1)));
        const md = buildMarketData(rows, []);
        const expected = rows.filter((r) => r.date <= asOf).sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
        expect(md.latestPriceAtOrBefore("a1", asOf)).toEqual(expected);
      }),
    );
  });
});
