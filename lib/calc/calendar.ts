/**
 * Business-day arithmetic over a pack's `MarketCalendar`
 * (docs/milestone-2-plan.md "Calendar and staleness").
 *
 * The calendar is DATA supplied by the pack (weekend + holidays); every
 * computation on it lives here. `businessDaysBetween` counts the half-open
 * interval (from, to], which is what BUS/252 accrual needs: a deposit made
 * today has accrued for zero business days today.
 */
import type { DayCount, MarketCalendar } from "@/packs/types";
import { KernelDecimal, type KDecimal } from "./decimal";
import { addDays, compareDates, dayOfWeek, days30360, daysBetween, yearOf } from "./dates";

// holidays(year) may build an array each call; memoise per calendar and year.
const holidayCache = new WeakMap<MarketCalendar, Map<number, ReadonlySet<string>>>();

function holidaySet(calendar: MarketCalendar, year: number): ReadonlySet<string> {
  let byYear = holidayCache.get(calendar);
  if (!byYear) {
    byYear = new Map();
    holidayCache.set(calendar, byYear);
  }
  let set = byYear.get(year);
  if (!set) {
    set = new Set(calendar.holidays(year));
    byYear.set(year, set);
  }
  return set;
}

export function isBusinessDay(calendar: MarketCalendar, date: string): boolean {
  if (calendar.weekend.includes(dayOfWeek(date))) return false;
  return !holidaySet(calendar, yearOf(date)).has(date);
}

/**
 * Business days in (from, to]. Signed: negative when `to` precedes `from`, so
 * the count is additive over adjacent intervals in either direction.
 */
export function businessDaysBetween(calendar: MarketCalendar, from: string, to: string): number {
  if (compareDates(from, to) > 0) {
    const reversed = businessDaysBetween(calendar, to, from);
    // `-0` would print as "-0" once it reaches a Decimal; keep zero unsigned.
    return reversed === 0 ? 0 : -reversed;
  }
  let count = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) {
    if (isBusinessDay(calendar, d)) count += 1;
  }
  return count;
}

/** Year fraction of (from, to] under the day-count convention, as a Decimal. */
export function yearFraction(calendar: MarketCalendar, dayCount: DayCount, from: string, to: string): KDecimal {
  switch (dayCount) {
    case "BUS/252":
      return new KernelDecimal(businessDaysBetween(calendar, from, to)).div(252);
    case "ACT/365":
      return new KernelDecimal(daysBetween(from, to)).div(365);
    case "ACT/360":
      return new KernelDecimal(daysBetween(from, to)).div(360);
    case "30/360":
      return new KernelDecimal(days30360(from, to)).div(360);
  }
}

/**
 * The longest run of consecutive closed days (weekend ∪ holidays) touching
 * `year`. A run that straddles New Year is measured whole, not cut at the
 * boundary, so the window derived from it is never too short.
 */
export function longestClosureRun(calendar: MarketCalendar, year: number): number {
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  // Wide enough to contain any run that touches the year on either side.
  const start = addDays(first, -14);
  const end = addDays(last, 14);
  let longest = 0;
  let run = 0;
  let runTouchesYear = false;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isBusinessDay(calendar, d)) {
      if (runTouchesYear && run > longest) longest = run;
      run = 0;
      runTouchesYear = false;
    } else {
      run += 1;
      if (d >= first && d <= last) runTouchesYear = true;
    }
  }
  if (runTouchesYear && run > longest) longest = run;
  return longest;
}

/**
 * Staleness window for a pack in a given year: the longest closure run plus
 * one day, so a price from the last business day before the longest holiday
 * is still "carried forward" on the first day after it, and anything older
 * is stale. BR 2026: Carnival Sat 14 – Tue 17 Feb → 4 + 1 = 5.
 */
export function stalenessWindowDays(calendar: MarketCalendar, year: number): number {
  return longestClosureRun(calendar, year) + 1;
}
