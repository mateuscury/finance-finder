import { describe, expect, it } from "vitest";
import { brCalendar, easterSunday } from "./calendar";

describe("easterSunday", () => {
  it.each([
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2000, "2000-04-23"],
  ])("computes Gregorian Easter for %i", (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });
});

describe("brCalendar.holidays", () => {
  it("includes the fixed national holidays", () => {
    const h = brCalendar.holidays(2025);
    for (const d of [
      "2025-01-01",
      "2025-04-21",
      "2025-05-01",
      "2025-09-07",
      "2025-10-12",
      "2025-11-02",
      "2025-11-15",
      "2025-12-25",
    ]) {
      expect(h).toContain(d);
    }
  });

  it("includes the moveable feasts derived from Easter", () => {
    const h2025 = brCalendar.holidays(2025);
    expect(h2025).toContain("2025-03-03"); // Carnival Monday
    expect(h2025).toContain("2025-03-04"); // Carnival Tuesday
    expect(h2025).toContain("2025-04-18"); // Good Friday
    expect(h2025).toContain("2025-06-19"); // Corpus Christi

    const h2024 = brCalendar.holidays(2024);
    expect(h2024).toContain("2024-02-12");
    expect(h2024).toContain("2024-02-13");
    expect(h2024).toContain("2024-03-29");
    expect(h2024).toContain("2024-05-30");
  });

  it("adds Consciência Negra (20 Nov) only from 2024, when it became national", () => {
    expect(brCalendar.holidays(2023)).not.toContain("2023-11-20");
    expect(brCalendar.holidays(2024)).toContain("2024-11-20");
  });

  it("returns sorted, unique ISO dates", () => {
    const h = brCalendar.holidays(2025);
    expect(h).toEqual([...new Set(h)].sort());
    for (const d of h) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("brCalendar metadata", () => {
  it("is São Paulo time, weekend Sat/Sun, T+2 settlement", () => {
    expect(brCalendar.timezone).toBe("America/Sao_Paulo");
    expect(brCalendar.weekend).toEqual([0, 6]);
    expect(brCalendar.settlement).toBe("T+2");
  });
});
