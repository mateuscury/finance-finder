import { describe, expect, it } from "vitest";
import { INSTANCE_DEFAULTS } from "./defaults";
import { isRefreshing, parseLocale, parseTheme, REFRESHING_WINDOW_MS } from "./preferences";

describe("preference parsing", () => {
  it("accepts a shipped locale and falls back to the instance default for anything else", () => {
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("pt-BR")).toBe("pt-BR");
    expect(parseLocale("fr")).toBe(INSTANCE_DEFAULTS.locale);
    expect(parseLocale(undefined)).toBe(INSTANCE_DEFAULTS.locale);
    expect(parseLocale("<script>")).toBe(INSTANCE_DEFAULTS.locale);
  });

  it("accepts the three themes and falls back to the default", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("blue")).toBe(INSTANCE_DEFAULTS.theme);
    expect(parseTheme(null)).toBe(INSTANCE_DEFAULTS.theme);
  });

  it("isRefreshing holds for the window after a press and rejects junk", () => {
    const now = 1_800_000_000_000;
    expect(isRefreshing(String(now - 1_000), now)).toBe(true);
    expect(isRefreshing(String(now - REFRESHING_WINDOW_MS), now)).toBe(false);
    expect(isRefreshing(String(now + 5_000), now)).toBe(false);
    expect(isRefreshing("not-a-number", now)).toBe(false);
    expect(isRefreshing(undefined, now)).toBe(false);
  });
});
