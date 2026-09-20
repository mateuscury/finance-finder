import { describe, expect, it } from "vitest";
import { isPublicPath, redirectFor, resolveAccess, type AuthReader } from "./access";

function fakeAuth(user: { id: string; email?: string } | null, aal: { currentLevel: string | null; nextLevel: string | null } | null = null): AuthReader {
  return {
    getUser: async () => ({ data: { user }, error: user ? null : { message: "no session" } }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: aal, error: null }) },
  };
}

describe("resolveAccess", () => {
  it("is unauthenticated without a verified user, whatever the cookie says", async () => {
    expect(await resolveAccess(fakeAuth(null))).toEqual({ kind: "unauthenticated" });
  });

  it("is ok at AAL1 when no factor is enrolled, and at AAL2 when one is", async () => {
    expect(await resolveAccess(fakeAuth({ id: "u1", email: "o@x" }, { currentLevel: "aal1", nextLevel: "aal1" }))).toEqual({
      kind: "ok",
      identity: { userId: "u1", email: "o@x", currentLevel: "aal1", nextLevel: "aal1" },
    });
    expect((await resolveAccess(fakeAuth({ id: "u1" }, { currentLevel: "aal2", nextLevel: "aal2" }))).kind).toBe("ok");
  });

  it("requires MFA when a factor exists but the session is only AAL1", async () => {
    const access = await resolveAccess(fakeAuth({ id: "u1" }, { currentLevel: "aal1", nextLevel: "aal2" }));
    expect(access.kind).toBe("mfa_required");
  });

  it("treats a missing AAL answer as AAL1 with nothing to step up to", async () => {
    expect((await resolveAccess(fakeAuth({ id: "u1" }, null))).kind).toBe("ok");
  });
});

describe("redirectFor", () => {
  const ok = { kind: "ok", identity: { userId: "u", email: null, currentLevel: "aal1" as const, nextLevel: "aal1" as const } } as const;
  const mfa = { kind: "mfa_required", identity: ok.identity } as const;
  const anon = { kind: "unauthenticated" } as const;

  it("sends anonymous data requests to /login and leaves the login family alone", () => {
    expect(redirectFor("/", anon)).toBe("/login");
    expect(redirectFor("/assets", anon)).toBe("/login");
    expect(redirectFor("/login", anon)).toBeNull();
    expect(redirectFor("/login/reset", anon)).toBeNull();
    expect(redirectFor("/auth/callback", anon)).toBeNull();
  });

  it("sends an AAL1 session with a factor to /login/mfa, but not from the login family", () => {
    expect(redirectFor("/transactions", mfa)).toBe("/login/mfa");
    expect(redirectFor("/login/mfa", mfa)).toBeNull();
    expect(redirectFor("/login", mfa)).toBeNull();
  });

  it("bounces a signed-in user off the login and challenge pages only", () => {
    expect(redirectFor("/login", ok)).toBe("/");
    expect(redirectFor("/login/mfa", ok)).toBe("/");
    expect(redirectFor("/login/reset", ok)).toBeNull();
    expect(redirectFor("/settings", ok)).toBeNull();
  });

  it("isPublicPath is the login family and the auth callback, nothing else", () => {
    for (const p of ["/login", "/login/mfa", "/login/reset", "/auth/callback"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/", "/loginx", "/assets", "/api/cron/prices"]) expect(isPublicPath(p)).toBe(false);
  });
});
