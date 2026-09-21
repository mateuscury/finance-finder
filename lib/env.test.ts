import { afterEach, describe, expect, it } from "vitest";
import { publicEnv, resetEnvCache, serverEnv, siteUrl } from "./env";

const NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));

function set(values: Partial<Record<(typeof NAMES)[number], string | undefined>>): void {
  for (const n of NAMES) {
    const v = values[n];
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
  resetEnvCache();
}

afterEach(() => {
  set(saved as Record<(typeof NAMES)[number], string | undefined>);
});

describe("env", () => {
  it("parses a valid public set once and strips the site URL's trailing slash", () => {
    set({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-for-test",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000/",
    });
    expect(publicEnv().NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(siteUrl()).toBe("http://127.0.0.1:3000");
    // Memoised: a later change to process.env is not seen until the cache is reset.
    process.env.NEXT_PUBLIC_SITE_URL = "http://elsewhere.test";
    expect(siteUrl()).toBe("http://127.0.0.1:3000");
  });

  it("names the missing variables and no other", () => {
    set({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      NEXT_PUBLIC_SITE_URL: undefined,
    });
    expect(() => publicEnv()).toThrow(/^env: missing or invalid NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SITE_URL$/);
  });

  it("never carries a value in its message", () => {
    const distinctive = "not-a-url-QX7ZP9";
    set({
      NEXT_PUBLIC_SUPABASE_URL: distinctive,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "k",
      NEXT_PUBLIC_SITE_URL: "http://x.test",
    });
    let message = "";
    try {
      publicEnv();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(message).not.toContain(distinctive);
  });

  it("validates the service-role key separately, by name", () => {
    set({ SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect(() => serverEnv()).toThrow(/^env: missing or invalid SUPABASE_SERVICE_ROLE_KEY$/);
    set({ SUPABASE_SERVICE_ROLE_KEY: "service-key-for-test" });
    expect(serverEnv().SUPABASE_SERVICE_ROLE_KEY).toBe("service-key-for-test");
  });
});
