/**
 * Brazilian market calendar (PACKS.md §9, §13).
 *
 * This is the ANBIMA / national-holiday calendar used for BUS/252 day counts
 * (CDI, SELIC, private credit). It deliberately does NOT include the B3
 * equity-only closures on 24 and 31 December, because CDI is still published
 * on those days and including them would corrupt every accrual. See README
 * "Quirks" for the consequence on equity staleness detection.
 */
import type { MarketCalendar } from "../types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Add `days` to a "YYYY-MM-DD" using UTC arithmetic so DST never bites. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const r = new Date(t);
  return iso(r.getUTCFullYear(), r.getUTCMonth() + 1, r.getUTCDate());
}

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

export function brHolidays(year: number): string[] {
  const easter = easterSunday(year);
  const fixed = [
    iso(year, 1, 1), // Confraternização Universal
    iso(year, 4, 21), // Tiradentes
    iso(year, 5, 1), // Dia do Trabalho
    iso(year, 9, 7), // Independência
    iso(year, 10, 12), // Nossa Senhora Aparecida
    iso(year, 11, 2), // Finados
    iso(year, 11, 15), // Proclamação da República
    iso(year, 12, 25), // Natal
  ];
  if (year >= 2024) fixed.push(iso(year, 11, 20)); // Consciência Negra — Lei 14.759/2023
  const moveable = [
    addDays(easter, -48), // Carnival Monday
    addDays(easter, -47), // Carnival Tuesday
    addDays(easter, -2), // Good Friday
    addDays(easter, 60), // Corpus Christi
  ];
  return [...new Set([...fixed, ...moveable])].sort();
}

export const brCalendar: MarketCalendar = {
  timezone: "America/Sao_Paulo",
  weekend: [0, 6],
  holidays: brHolidays,
  settlement: "T+2",
};
