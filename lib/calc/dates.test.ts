import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  compareDates,
  completedMonths,
  dayOfWeek,
  days30360,
  daysBetween,
  daysInMonth,
  inWindow,
  isIsoDate,
  isLeapYear,
  parseIsoDate,
  yearOf,
} from "./dates";
import { isKernelError } from "./errors";

/** Any real calendar day between 1900 and 2199, built without kernel code. */
const isoDate = fc
  .tuple(fc.integer({ min: 1900, max: 2199 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 31 }))
  .map(([y, m, d]) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const dim = m === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
    const day = d > dim ? dim : d;
    return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  });

describe("parseIsoDate", () => {
  it("accepts real calendar days only", () => {
    expect(parseIsoDate("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseIsoDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    for (const bad of [
      "2026-02-29",
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-1-1",
      "26-01-01",
      "2026/01/01",
      "2026-01-01T00:00",
      "",
      "2100-02-29",
    ]) {
      expect(() => parseIsoDate(bad), bad).toThrow();
      try {
        parseIsoDate(bad, "tradeDate");
      } catch (err) {
        expect(isKernelError(err, "invalid_date")).toBe(true);
        expect((err as Error).message).toContain("tradeDate");
      }
    }
    expect(isIsoDate("2026-01-01")).toBe(true);
    expect(isIsoDate("2026-01-32")).toBe(false);
    expect(isIsoDate(20260101)).toBe(false);
  });

  it("knows leap years and month lengths", () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("day arithmetic", () => {
  it("adds and subtracts across month, year and leap boundaries", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-01-01", 0)).toBe("2026-01-01");
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
    expect(daysBetween("2024-01-01", "2024-12-31")).toBe(365);
    expect(daysBetween("2026-03-01", "2026-02-01")).toBe(-28);
  });

  it("property: addDays and daysBetween are inverse, and daysBetween is additive", () => {
    fc.assert(
      fc.property(isoDate, fc.integer({ min: -20_000, max: 20_000 }), isoDate, (a, n, c) => {
        const b = addDays(a, n);
        expect(daysBetween(a, b)).toBe(n);
        expect(addDays(b, -n)).toBe(a);
        expect(daysBetween(a, b) + daysBetween(b, c)).toBe(daysBetween(a, c));
      }),
    );
  });

  it("property: compareDates agrees with daysBetween", () => {
    fc.assert(
      fc.property(isoDate, isoDate, (a, b) => {
        const d = daysBetween(a, b);
        expect(compareDates(a, b)).toBe(d > 0 ? -1 : d < 0 ? 1 : 0);
      }),
    );
  });

  it("dayOfWeek uses the JS convention (0 = Sunday)", () => {
    expect(dayOfWeek("2026-01-01")).toBe(4); // Thursday
    expect(dayOfWeek("2026-02-14")).toBe(6); // Carnival Saturday
    expect(dayOfWeek("2026-02-15")).toBe(0);
    expect(yearOf("2026-06-30")).toBe(2026);
  });

  it("property: dayOfWeek advances by one per day, modulo 7", () => {
    fc.assert(
      fc.property(isoDate, fc.integer({ min: -1000, max: 1000 }), (a, n) => {
        expect(dayOfWeek(addDays(a, n))).toBe((((dayOfWeek(a) + n) % 7) + 7) % 7);
      }),
    );
  });
});

describe("month arithmetic", () => {
  it("clamps to the end of the target month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-01-15", 12)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -13)).toBe("2024-12-15");
  });

  it("counts completed months by anniversary", () => {
    expect(completedMonths("2026-01-15", "2026-02-14")).toBe(0);
    expect(completedMonths("2026-01-15", "2026-02-15")).toBe(1);
    expect(completedMonths("2026-01-31", "2026-02-28")).toBe(1); // clamped anniversary
    expect(completedMonths("2026-01-31", "2026-03-30")).toBe(1);
    expect(completedMonths("2026-01-31", "2026-03-31")).toBe(2);
    expect(completedMonths("2026-01-15", "2027-01-15")).toBe(12);
    expect(completedMonths("2026-01-15", "2025-12-31")).toBe(0);
    expect(completedMonths("2026-01-15", "2026-01-15")).toBe(0);
  });

  it("property: completedMonths(from, addMonths(from, n)) === n for n ≥ 0", () => {
    fc.assert(
      fc.property(isoDate, fc.integer({ min: 0, max: 600 }), (a, n) => {
        expect(completedMonths(a, addMonths(a, n))).toBe(n);
        expect(completedMonths(a, addDays(addMonths(a, n), -1))).toBe(n === 0 ? 0 : n - 1);
      }),
    );
  });
});

describe("30/360 (US)", () => {
  it("matches the NASD rule on the classic edge cases", () => {
    expect(days30360("2026-01-15", "2026-02-15")).toBe(30);
    expect(days30360("2026-01-31", "2026-02-28")).toBe(28); // d1 31→30; Feb end not adjusted
    expect(days30360("2026-01-30", "2026-03-31")).toBe(60); // d2 31→30 because d1 ≥ 30
    expect(days30360("2026-01-15", "2026-03-31")).toBe(76); // d2 stays 31 because d1 < 30
    expect(days30360("2026-01-01", "2027-01-01")).toBe(360);
    expect(days30360("2026-02-28", "2026-03-01")).toBe(3);
  });

  it("property: same date is 0; whole years are 360 each when the anniversary is not clamped", () => {
    // Day ≤ 28 so addMonths never clamps: 1928-02-29 + 12 months is
    // 1929-02-28, and US 30/360 correctly gives 359 for that pair because
    // the February end-of-month rule is deliberately not applied.
    const unclamped = isoDate.filter((d) => d.slice(8) <= "28");
    fc.assert(
      fc.property(unclamped, fc.integer({ min: 0, max: 30 }), (a, years) => {
        expect(days30360(a, a)).toBe(0);
        expect(days30360(a, addMonths(a, 12 * years))).toBe(360 * years);
      }),
    );
    expect(days30360("1928-02-29", "1929-02-28")).toBe(359);
  });
});

describe("inWindow", () => {
  it("is the half-open (from, to]", () => {
    expect(inWindow("2026-02-10", "2026-02-10", "2026-02-13")).toBe(false);
    expect(inWindow("2026-02-11", "2026-02-10", "2026-02-13")).toBe(true);
    expect(inWindow("2026-02-13", "2026-02-10", "2026-02-13")).toBe(true);
    expect(inWindow("2026-02-14", "2026-02-10", "2026-02-13")).toBe(false);
  });
});
