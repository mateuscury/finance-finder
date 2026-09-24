/**
 * Sign-in, uniform failure and the TOTP second factor against the local
 * Auth (specs/SPEC.md US-003 AC-003.7; SPEC §9.6). The TOTP codes come from
 * `lib/testing/totp.ts` — an RFC 6238 generator running the same arithmetic an
 * authenticator app does, so the test proves enrolment end to end without a
 * device. The browser journeys enrol with the same generator (P7-U1).
 *
 * Runs under `pnpm test:db` only.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertStackReachable,
  createDbTestClient,
  createThrowawayUser,
  requireDbEnv,
  type ThrowawayUserHandle,
} from "@/lib/testing/db";
import { redirectFor, resolveAccess } from "./access";
import { totp } from "@/lib/testing/totp";

const admin = createDbTestClient();
const users: ThrowawayUserHandle[] = [];
beforeAll(async () => {
  await assertStackReachable(admin);
});
afterAll(async () => {
  for (const u of users) await u.remove();
});

function anonClient() {
  const { url, anonKey } = requireDbEnv();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

describe("sign-in", () => {
  it("a wrong password and an unknown email produce identical failures", async () => {
    const user = await createThrowawayUser(admin);
    users.push(user);
    const wrong = await anonClient().auth.signInWithPassword({
      email: user.email,
      password: "Aa1!definitely-not-the-password",
    });
    const unknown = await anonClient().auth.signInWithPassword({
      email: `nobody-${randomUUID()}@example.com`,
      password: "Aa1!whatever-it-is",
    });
    expect(wrong.error).not.toBeNull();
    expect(unknown.error).not.toBeNull();
    expect({ status: wrong.error?.status, message: wrong.error?.message }).toEqual({
      status: unknown.error?.status,
      message: unknown.error?.message,
    });
    expect(wrong.data.session).toBeNull();
    expect(unknown.data.session).toBeNull();
  });

  it("a verified user without a factor is ok at AAL1 and signs out locally", async () => {
    const user = await createThrowawayUser(admin);
    users.push(user);
    const client = await user.signIn();
    const access = await resolveAccess(client.auth);
    expect(access).toMatchObject({
      kind: "ok",
      identity: { userId: user.userId, email: user.email, currentLevel: "aal1", nextLevel: "aal1" },
    });
    expect(redirectFor("/assets", access)).toBeNull();
    await client.auth.signOut({ scope: "local" });
    expect((await resolveAccess(client.auth)).kind).toBe("unauthenticated");
  });
});

describe("TOTP second factor", () => {
  it("enrolling and verifying a code raises the session to AAL2; a fresh sign-in is then held at the challenge", async () => {
    const user = await createThrowawayUser(admin);
    users.push(user);
    const client = await user.signIn();

    const enrolled = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "dbtest" });
    expect(enrolled.error).toBeNull();
    const factorId = enrolled.data!.id;
    const secret = enrolled.data!.totp.secret;
    expect(enrolled.data!.totp.qr_code).toMatch(/^data:image\/svg\+xml/);

    // Before verification the factor is not counted: still AAL1 → AAL1.
    expect((await resolveAccess(client.auth)).kind).toBe("ok");

    const challenge = await client.auth.mfa.challenge({ factorId });
    expect(challenge.error).toBeNull();
    let verified = await client.auth.mfa.verify({ factorId, challengeId: challenge.data!.id, code: totp(secret) });
    if (verified.error) {
      // A code generated on a step boundary may have just expired; one retry.
      const again = await client.auth.mfa.challenge({ factorId });
      verified = await client.auth.mfa.verify({ factorId, challengeId: again.data!.id, code: totp(secret) });
    }
    expect(verified.error).toBeNull();

    const stepped = await resolveAccess(client.auth);
    expect(stepped).toMatchObject({ kind: "ok", identity: { currentLevel: "aal2", nextLevel: "aal2" } });

    // A brand-new password session on the same user is what requireUser() redirects.
    const fresh = await user.signIn();
    const held = await resolveAccess(fresh.auth);
    expect(held).toMatchObject({ kind: "mfa_required", identity: { currentLevel: "aal1", nextLevel: "aal2" } });
    expect(redirectFor("/assets", held)).toBe("/login/mfa");
    expect(redirectFor("/login/mfa", held)).toBeNull();

    // The challenge page's own path: one verified factor, challengeAndVerify.
    const factors = await fresh.auth.mfa.listFactors();
    const factor = factors.data!.totp.find((f) => f.status === "verified")!;
    let passed = await fresh.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(secret) });
    if (passed.error)
      passed = await fresh.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: totp(secret, Date.now() + 30_000),
      });
    expect(passed.error).toBeNull();
    expect((await resolveAccess(fresh.auth)).kind).toBe("ok");

    // A wrong code never verifies.
    const wrong = await fresh.auth.mfa.challengeAndVerify({ factorId: factor.id, code: "000000" });
    expect(wrong.error).not.toBeNull();
  });

  it("the RFC 6238 generator matches the published test vector", () => {
    // RFC 6238 Appendix B, SHA-1, secret "12345678901234567890" (base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ), T = 59 → 94287082.
    expect(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000, 30, 8)).toBe("94287082");
  });
});
