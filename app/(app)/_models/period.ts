/**
 * The period selector shared by the analysis screens (SPEC §9 screen 2;
 * US-010 AC-010.1). Pure over the snapshot span: `to` is the last snapshot
 * date; `from` is the latest snapshot date at or before the period's
 * nominal start, so the first sub-period has a start value to chain from.
 */
import type { IsoDate } from "@/packs/types";
import { addMonths, daysBetween, yearOf } from "@/lib/calc/dates";
import type { SnapshotRange } from "@/lib/ledger/snapshots";

export const PERIOD_KEYS = ["1m", "ytd", "1y", "all"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface Period {
  key: PeriodKey;
  from: IsoDate;
  to: IsoDate;
}

export function isPeriodKey(value: string | null | undefined): value is PeriodKey {
  return (PERIOD_KEYS as readonly string[]).includes(value ?? "");
}

/** "all" while the history is shorter than a year, else "1y". */
export function defaultPeriod(range: SnapshotRange): PeriodKey {
  if (!range.first || !range.last) return "all";
  return daysBetween(range.first, range.last) < 365 ? "all" : "1y";
}

/** The nominal start of a period ending at `to`. */
function nominalStart(key: PeriodKey, to: IsoDate, first: IsoDate): IsoDate {
  switch (key) {
    case "1m":
      return addMonths(to, -1);
    case "ytd":
      return `${yearOf(to)}-01-01`;
    case "1y":
      return addMonths(to, -12);
    case "all":
      return first;
  }
}

/**
 * Resolves a period over the dates that have snapshots. Null below two
 * dates, or when no date lies at or before the nominal start (a "1y" over a
 * three-month history is then not offered; the screen falls back to "all").
 */
export function resolvePeriod(key: PeriodKey, range: SnapshotRange, dates: readonly IsoDate[]): Period | null {
  if (!range.first || !range.last || dates.length < 2) return null;
  const to = range.last;
  const start = nominalStart(key, to, range.first);
  let from: IsoDate | null = null;
  for (const d of dates) {
    if (d <= start) from = d;
    else break;
  }
  if (key === "all") from = range.first;
  if (from === null || from >= to) return null;
  return { key, from, to };
}

/** The period from a query value: the key if valid and resolvable, else the default, else null. */
export function periodFrom(
  param: string | string[] | undefined,
  range: SnapshotRange,
  dates: readonly IsoDate[],
): Period | null {
  const wanted = typeof param === "string" && isPeriodKey(param) ? param : defaultPeriod(range);
  return resolvePeriod(wanted, range, dates) ?? resolvePeriod("all", range, dates);
}
