import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";

const createClient = vi.fn((..._args: unknown[]) => ({ tag: "client" }));
vi.mock("@supabase/supabase-js", () => ({ createClient: (...a: unknown[]) => createClient(...a) }));

const { createServiceRoleClient } = await import("./service");

afterEach(() => {
  resetEnvCache();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("createServiceRoleClient", () => {
  it("builds a client on the service-role key with no session persistence", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3000";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key-for-test";
    resetEnvCache();
    expect(createServiceRoleClient()).toEqual({ tag: "client" });
    expect(createClient).toHaveBeenCalledWith("http://127.0.0.1:54321", "service-key-for-test", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it("fails by variable name when the key is absent, before any client exists", () => {
    createClient.mockClear();
    resetEnvCache();
    expect(() => createServiceRoleClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(createClient).not.toHaveBeenCalled();
  });
});
