import { describe, expect, it } from "vitest";
import { defaultPeriod, periodFrom, resolvePeriod } from "./period";

const DATES = [
  "2025-01-02",
  "2025-02-27",
  "2025-06-02",
  "2025-09-01",
  "2025-12-30",
  "2026-01-02",
  "2026-01-30",
  "2026-02-27",
];
const range = { first: DATES[0], last: DATES.at(-1)! };

describe("resolvePeriod", () => {
  it("ends at the last snapshot and starts at the latest snapshot on or before the nominal start", () => {
    expect(resolvePeriod("1m", range, DATES)).toEqual({ key: "1m", from: "2026-01-02", to: "2026-02-27" });
    expect(resolvePeriod("ytd", range, DATES)).toEqual({ key: "ytd", from: "2025-12-30", to: "2026-02-27" });
    // Nominal start 2025-02-27 is itself a snapshot date: the period starts there.
    expect(resolvePeriod("1y", range, DATES)).toEqual({ key: "1y", from: "2025-02-27", to: "2026-02-27" });
    expect(resolvePeriod("all", range, DATES)).toEqual({ key: "all", from: "2025-01-02", to: "2026-02-27" });
  });

  it("is null below two snapshots, and when no snapshot reaches the nominal start", () => {
    expect(resolvePeriod("all", { first: "2026-02-27", last: "2026-02-27" }, ["2026-02-27"])).toBeNull();
    expect(resolvePeriod("1y", { first: "2026-01-02", last: "2026-02-27" }, ["2026-01-02", "2026-02-27"])).toBeNull();
    expect(resolvePeriod("all", { first: null, last: null }, [])).toBeNull();
  });

  it("defaults to all under a year of history and 1y beyond, and falls back to all when the key cannot resolve", () => {
    expect(defaultPeriod({ first: "2026-01-02", last: "2026-02-27" })).toBe("all");
    expect(defaultPeriod(range)).toBe("1y");
    expect(defaultPeriod({ first: null, last: null })).toBe("all");
    const short = { first: "2026-01-02", last: "2026-02-27" };
    expect(periodFrom("1y", short, ["2026-01-02", "2026-02-27"])).toEqual({
      key: "all",
      from: "2026-01-02",
      to: "2026-02-27",
    });
    expect(periodFrom("bogus", range, DATES)?.key).toBe("1y");
    expect(periodFrom(undefined, short, ["2026-01-02", "2026-02-27"])?.key).toBe("all");
  });
});
