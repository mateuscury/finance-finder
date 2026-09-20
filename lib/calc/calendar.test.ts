import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { MarketCalendar } from "@/packs/types";
import { brCalendar } from "@/packs/br/calendar";
import { businessDaysBetween, isBusinessDay, longestClosureRun, stalenessWindowDays, yearFraction } from "./calendar";
import { addDays } from "./dates";

/** The global calendar as packs/global declares it: every day is open. */
const sevenDay: MarketCalendar = { timezone: "UTC", weekend: [], holidays: () => [], settlement: "T+0" };

const day2026 = fc.integer({ min: 0, max: 364 }).map((n) => addDays("2026-01-01", n));

describe("isBusinessDay (BR)", () => {
  it("closes weekends and holidays, keeps 24 and 31 December open", () => {
    expect(isBusinessDay(brCalendar, "2026-02-13")).toBe(true); // Friday before Carnival
    expect(isBusinessDay(brCalendar, "2026-02-14")).toBe(false); // Saturday
    expect(isBusinessDay(brCalendar, "2026-02-16")).toBe(false); // Carnival Monday
    expect(isBusinessDay(brCalendar, "2026-02-17")).toBe(false); // Carnival Tuesday
    expect(isBusinessDay(brCalendar, "2026-02-18")).toBe(true); // Ash Wednesday
    expect(isBusinessDay(brCalendar, "2026-04-03")).toBe(false); // Good Friday
    expect(isBusinessDay(brCalendar, "2026-11-20")).toBe(false); // Consciência Negra
    expect(isBusinessDay(brCalendar, "2026-12-24")).toBe(true); // CDI is published
    expect(isBusinessDay(brCalendar, "2026-12-31")).toBe(true);
    expect(isBusinessDay(brCalendar, "2026-12-25")).toBe(false);
  });
});

describe("businessDaysBetween", () => {
  it("counts the half-open interval (from, to]", () => {
    expect(businessDaysBetween(brCalendar, "2026-02-13", "2026-02-13")).toBe(0);
    expect(businessDaysBetween(brCalendar, "2026-02-13", "2026-02-18")).toBe(1); // only the 18th
    expect(businessDaysBetween(brCalendar, "2026-02-12", "2026-02-18")).toBe(2); // 13th and 18th
    expect(businessDaysBetween(brCalendar, "2026-02-13", "2026-02-17")).toBe(0); // all closed
  });

  it("BR 2026 has 249 business days", () => {
    // 365 days − 104 weekend days (2026 starts on a Thursday: 52 Saturdays,
    // 52 Sundays) − 12 weekday holidays: Jan 1 Thu, Feb 16 Mon, Feb 17 Tue,
    // Apr 3 Fri (Good Friday), Apr 21 Tue, May 1 Fri, Jun 4 Thu (Corpus
    // Christi), Sep 7 Mon, Oct 12 Mon, Nov 2 Mon, Nov 20 Fri, Dec 25 Fri.
    // Nov 15 falls on a Sunday and is already a weekend day.
    expect(businessDaysBetween(brCalendar, "2025-12-31", "2026-12-31")).toBe(249);
  });

  it("equals calendar days on a seven-day calendar", () => {
    expect(businessDaysBetween(sevenDay, "2026-01-01", "2026-12-31")).toBe(364);
  });

  it("property: additive over adjacent intervals and antisymmetric", () => {
    fc.assert(
      fc.property(day2026, day2026, day2026, (a, b, c) => {
        expect(businessDaysBetween(brCalendar, a, b) + businessDaysBetween(brCalendar, b, c)).toBe(
          businessDaysBetween(brCalendar, a, c),
        );
        // `0 - x` rather than `-x`: negating 0 yields -0, which Object.is rejects.
        expect(businessDaysBetween(brCalendar, a, b)).toBe(0 - businessDaysBetween(brCalendar, b, a));
      }),
    );
  });

  it("property: one more day adds 1 iff that day is a business day", () => {
    fc.assert(
      fc.property(day2026, fc.integer({ min: 0, max: 60 }), (a, n) => {
        const b = addDays(a, n);
        const next = addDays(b, 1);
        const delta = businessDaysBetween(brCalendar, a, next) - businessDaysBetween(brCalendar, a, b);
        expect(delta).toBe(isBusinessDay(brCalendar, next) ? 1 : 0);
      }),
    );
  });
});

describe("yearFraction", () => {
  it("applies each day-count convention", () => {
    expect(yearFraction(brCalendar, "BUS/252", "2025-12-31", "2026-12-31").toFixed()).toBe(
      "0." + "9880952380952380952380952380952380952381",
    ); // 249/252 at 40 digits, half-even
    expect(yearFraction(brCalendar, "ACT/365", "2026-01-01", "2027-01-01").toFixed()).toBe("1");
    expect(yearFraction(brCalendar, "ACT/360", "2026-01-01", "2026-07-01").toFixed()).toBe(
      "0.5027777777777777777777777777777777777778",
    ); // 181/360
    expect(yearFraction(brCalendar, "30/360", "2026-01-01", "2027-01-01").toFixed()).toBe("1");
    expect(yearFraction(brCalendar, "30/360", "2026-01-15", "2026-02-15").toFixed()).toBe(
      "0.08333333333333333333333333333333333333333",
    ); // 30/360 at 40 significant digits
  });

  it("property: BUS/252 × 252 recovers the business-day count to 40 digits", () => {
    // Not an identity: 1/252 at precision 40, times 252, is 0.999…9, and for
    // a count near 100 the last place is the 38th decimal. The golden gate
    // compares at 1e-8 for exactly this reason.
    fc.assert(
      fc.property(day2026, day2026, (a, b) => {
        const yf = yearFraction(brCalendar, "BUS/252", a, b);
        const n = businessDaysBetween(brCalendar, a, b);
        expect(yf.times(252).minus(n).abs().lt("1e-36")).toBe(true);
        expect(yf.isNegative()).toBe(n < 0);
      }),
    );
  });
});

describe("staleness window", () => {
  it("BR 2026: Carnival is the longest closure (4 days) → window 5", () => {
    expect(longestClosureRun(brCalendar, 2026)).toBe(4);
    expect(stalenessWindowDays(brCalendar, 2026)).toBe(5);
  });

  it("a seven-day calendar has no closures → window 1 (fresh today, carried one day)", () => {
    expect(longestClosureRun(sevenDay, 2026)).toBe(0);
    expect(stalenessWindowDays(sevenDay, 2026)).toBe(1);
  });

  it("measures a run that straddles New Year whole", () => {
    // 2027: Fri 1 Jan is a holiday, then Sat 2 and Sun 3 → 3-day run at the
    // start of the year; 2026 ends on Thu 31 Dec (open). Both years see it.
    // A synthetic calendar that also closes 30–31 Dec 2026 makes it 5 days,
    // and BOTH 2026 and 2027 must report 5.
    const closesYearEnd: MarketCalendar = {
      ...brCalendar,
      holidays: (y) => (y === 2026 ? [...brCalendar.holidays(y), "2026-12-30", "2026-12-31"] : brCalendar.holidays(y)),
    };
    expect(longestClosureRun(closesYearEnd, 2026)).toBe(5);
    expect(longestClosureRun(closesYearEnd, 2027)).toBe(5);
  });
});
