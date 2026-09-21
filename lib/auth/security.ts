/**
 * Account security writes (SPEC §9.6): password change, TOTP enrolment and
 * removal, sign out everywhere. Each takes the user's own client — the
 * cookie session — and returns a fixed reason, never Auth's message.
 */
import type { Db } from "@/lib/supabase/types";
import { z } from "zod";

export type SecurityReason =
  "invalid_input" | "aal2_required" | "wrong_password" | "auth_failed" | "no_factor" | "code_rejected";
export type SecurityResult<T = undefined> = { ok: true; value: T } | { ok: false; reason: SecurityReason };

const NewPassword = z
  .object({ password: z.string().min(12), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "must match" });

export async function changePassword(client: Db, input: unknown): Promise<SecurityResult> {
  const parsed = NewPassword.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const { error } = await client.auth.updateUser({ password: parsed.data.password });
  return error ? { ok: false, reason: "auth_failed" } : { ok: true, value: undefined };
}

export interface Enrolment {
  factorId: string;
  /** SVG data URI from Auth; rendered as an image, never stored. */
  qrCode: string;
  /** For manual entry into an authenticator; shown once. */
  secret: string;
}

/** Starts enrolment: the factor exists as `unverified` until `confirmTotp`. Stale unverified factors are cleared first. */
export async function enrolTotp(client: Db): Promise<SecurityResult<Enrolment>> {
  const factors = await client.auth.mfa.listFactors();
  // `totp` lists verified factors only; unverified leftovers of an abandoned enrolment are in `all`.
  for (const f of factors.data?.all ?? [])
    if (f.factor_type === "totp" && f.status === "unverified") await client.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Finance Finder" });
  if (error || !data) return { ok: false, reason: "auth_failed" };
  return { ok: true, value: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } };
}

export async function confirmTotp(client: Db, input: unknown): Promise<SecurityResult> {
  const parsed = z
    .object({
      factorId: z.string().min(1),
      code: z
        .string()
        .trim()
        .regex(/^\d{6}$/),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const { error } = await client.auth.mfa.challengeAndVerify(parsed.data);
  return error ? { ok: false, reason: "code_rejected" } : { ok: true, value: undefined };
}

/** Removal of a verified factor needs an AAL2 session — the action checks `requireAal2` first. */
export async function unenrolTotp(client: Db): Promise<SecurityResult> {
  const factors = await client.auth.mfa.listFactors();
  const verified = factors.data?.totp ?? [];
  if (verified.length === 0) return { ok: false, reason: "no_factor" };
  for (const f of verified) {
    const { error } = await client.auth.mfa.unenroll({ factorId: f.id });
    if (error) return { ok: false, reason: "auth_failed" };
  }
  return { ok: true, value: undefined };
}

export async function signOutEverywhere(client: Db): Promise<SecurityResult> {
  const { error } = await client.auth.signOut({ scope: "global" });
  return error ? { ok: false, reason: "auth_failed" } : { ok: true, value: undefined };
}

/** A fresh password check for destructive actions, against a throwaway client so the session is untouched. */
export async function verifyPassword(makeClient: () => Db, email: string, password: string): Promise<boolean> {
  const { error } = await makeClient().auth.signInWithPassword({ email, password });
  return error === null;
}
