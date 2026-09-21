import { describe, expect, it } from "vitest";
import { nowMs, todayIso } from "./clock";

describe("clock", () => {
  it("todayIso is the UTC calendar day of the instant, and defaults to now", () => {
    expect(todayIso(Date.UTC(2026, 1, 27, 23, 59, 59))).toBe("2026-02-27");
    expect(todayIso(Date.UTC(2026, 1, 28, 0, 0, 0))).toBe("2026-02-28");
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Math.abs(nowMs() - Date.now())).toBeLessThan(1000);
  });
});
