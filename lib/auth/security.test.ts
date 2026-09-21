import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/supabase/types";
import { changePassword, confirmTotp, enrolTotp, unenrolTotp, verifyPassword } from "./security";

/** A fake of the auth surface these functions touch; every call is recorded. */
function fakeAuth(
  factors: { id: string; factor_type: string; status: "verified" | "unverified" }[],
  fail: Partial<Record<string, boolean>> = {},
) {
  const calls: string[] = [];
  const res = (name: string, data: unknown = null) => {
    calls.push(name);
    return Promise.resolve(fail[name] ? { data: null, error: { message: "x" } } : { data, error: null });
  };
  const client = {
    auth: {
      updateUser: () => res("updateUser"),
      signInWithPassword: () => res("signInWithPassword"),
      signOut: () => res("signOut"),
      mfa: {
        listFactors: () =>
          res("listFactors", {
            all: factors,
            totp: factors.filter((f) => f.status === "verified" && f.factor_type === "totp"),
          }),
        enroll: () =>
          res("enroll", { id: "f-new", totp: { qr_code: "data:image/svg+xml;utf-8,<svg/>", secret: "ABCDEF" } }),
        unenroll: () => res("unenroll"),
        challengeAndVerify: () => res("challengeAndVerify"),
      },
    },
  } as unknown as Db;
  return { client, calls };
}

describe("security", () => {
  it("changePassword validates length and match before touching Auth", async () => {
    const a = fakeAuth([]);
    expect(await changePassword(a.client, { password: "short", confirm: "short" })).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(await changePassword(a.client, { password: "Aa1!long-enough-1", confirm: "different-value!1A" })).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(a.calls).toEqual([]);
    expect(await changePassword(a.client, { password: "Aa1!long-enough-1", confirm: "Aa1!long-enough-1" })).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("enrolTotp clears abandoned unverified factors, then enrols and returns the QR and secret", async () => {
    const a = fakeAuth([{ id: "stale", factor_type: "totp", status: "unverified" }]);
    const r = await enrolTotp(a.client);
    expect(r).toEqual({
      ok: true,
      value: { factorId: "f-new", qrCode: "data:image/svg+xml;utf-8,<svg/>", secret: "ABCDEF" },
    });
    expect(a.calls).toEqual(["listFactors", "unenroll", "enroll"]);
  });

  it("confirmTotp needs a six-digit code; unenrolTotp needs a verified factor", async () => {
    const none = fakeAuth([]);
    expect(await confirmTotp(none.client, { factorId: "f", code: "12" })).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(await confirmTotp(none.client, { factorId: "f", code: "123456" })).toEqual({ ok: true, value: undefined });
    expect(await unenrolTotp(none.client)).toEqual({ ok: false, reason: "no_factor" });
    const one = fakeAuth([{ id: "v", factor_type: "totp", status: "verified" }]);
    expect(await unenrolTotp(one.client)).toEqual({ ok: true, value: undefined });
    const rejected = fakeAuth([], { challengeAndVerify: true });
    expect(await confirmTotp(rejected.client, { factorId: "f", code: "123456" })).toEqual({
      ok: false,
      reason: "code_rejected",
    });
  });

  it("verifyPassword uses the throwaway client it is handed, never the session", async () => {
    const good = fakeAuth([]);
    expect(await verifyPassword(() => good.client, "o@x", "pw")).toBe(true);
    const bad = fakeAuth([], { signInWithPassword: true });
    expect(await verifyPassword(() => bad.client, "o@x", "pw")).toBe(false);
  });
});
