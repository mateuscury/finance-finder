/**
 * ISO calendar dates ("YYYY-MM-DD") with UTC-only arithmetic
 * (docs/milestone-2-plan.md Phase 1).
 *
 * Every function takes and returns strings. There is no local time anywhere
 * in the kernel: a date is a calendar day, and `Date.UTC` is used purely as an
 * integer day counter so DST and time zones can never shift a day.
 *
 * Integer arithmetic only — these are day counts, not values. Values never
 * come through here.
 */
import { KernelError } from "./errors";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export interface CivilDate {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatCivil(civil: CivilDate): string {
  return `${civil.year}-${pad2(civil.month)}-${pad2(civil.day)}`;
}

/** Strict: shape AND a real calendar day ("2026-02-30" is `invalid_date`). */
export function parseIsoDate(input: string, field = "date"): CivilDate {
  const m = ISO_DATE.exec(input);
  if (!m) throw new KernelError("invalid_date", `${field} must be YYYY-MM-DD`, { field });
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new KernelError("invalid_date", `${field} is not a calendar day`, { field, date: input });
  }
  return { year, month, day };
}

export function isIsoDate(input: unknown): input is string {
  if (typeof input !== "string") return false;
  try {
    parseIsoDate(input);
    return true;
  } catch {
    return false;
  }
}

function toEpochMs(date: string, field?: string): number {
  const c = parseIsoDate(date, field);
  return Date.UTC(c.year, c.month - 1, c.day);
}

function fromEpochMs(ms: number): string {
  const d = new Date(ms);
  return formatCivil({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

export function addDays(date: string, days: number): string {
  return fromEpochMs(toEpochMs(date) + days * MS_PER_DAY);
}

/** Calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return (toEpochMs(to, "to") - toEpochMs(from, "from")) / MS_PER_DAY;
}

/** ISO strings sort lexicographically, but parse both so an invalid date is caught. */
export function compareDates(a: string, b: string): -1 | 0 | 1 {
  parseIsoDate(a, "a");
  parseIsoDate(b, "b");
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: string, b: string): string {
  return compareDates(a, b) <= 0 ? a : b;
}

export function maxDate(a: string, b: string): string {
  return compareDates(a, b) >= 0 ? a : b;
}

/** JS convention: 0 = Sunday … 6 = Saturday, so it matches `MarketCalendar.weekend`. */
export function dayOfWeek(date: string): number {
  return new Date(toEpochMs(date)).getUTCDay();
}

export function yearOf(date: string): number {
  return parseIsoDate(date).year;
}

/**
 * Month arithmetic with end-of-month clamping: Jan 31 + 1 month = Feb 28 (or
 * 29). This is the anniversary rule for `compounding: monthly | annual`
 * (docs/milestone-2-plan.md, accrual table).
 */
export function addMonths(date: string, months: number): string {
  const c = parseIsoDate(date);
  const total = c.year * 12 + (c.month - 1) + months;
  const year = (total - (((total % 12) + 12) % 12)) / 12;
  const month = (((total % 12) + 12) % 12) + 1;
  const dim = daysInMonth(year, month);
  return formatCivil({ year, month, day: c.day < dim ? c.day : dim });
}

/**
 * Whole months elapsed from `from` to `to` (0 when `to` precedes the first
 * anniversary). Anniversaries follow `addMonths`, so a lot opened on the 31st
 * has its February anniversary on the 28th/29th.
 */
export function completedMonths(from: string, to: string): number {
  const a = parseIsoDate(from, "from");
  const b = parseIsoDate(to, "to");
  if (compareDates(to, from) < 0) return 0;
  let n = (b.year - a.year) * 12 + (b.month - a.month);
  if (n > 0 && addMonths(from, n) > to) n -= 1;
  return n < 0 ? 0 : n;
}

/**
 * 30/360 US (NASD) day count, per the plan's "Calendar and staleness":
 *   if d1 = 31 → 30; if d2 = 31 and d1 ≥ 30 → 30 (after the d1 adjustment).
 * The February end-of-month rules of 30E/360 are deliberately NOT applied.
 */
export function days30360(from: string, to: string): number {
  const a = parseIsoDate(from, "from");
  const b = parseIsoDate(to, "to");
  let d1 = a.day;
  let d2 = b.day;
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 >= 30) d2 = 30;
  return 360 * (b.year - a.year) + 30 * (b.month - a.month) + (d2 - d1);
}
