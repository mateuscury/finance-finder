"use server";
/**
 * Login-family server actions (SPEC §9.6). Every failure path redirects to
 * the same page with the same flag: a wrong password, an unknown email, a
 * disabled account and a malformed form are indistinguishable to the caller
 * — the code never branches on the error kind.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/env";

const Credentials = z.object({ email: z.string().trim().min(1), password: z.string().min(1) });
const Code = z.object({ code: z.string().trim().regex(/^\d{6}$/) });
const Email = z.object({ email: z.string().trim().min(1) });
const NewPassword = z.object({ password: z.string().min(12), confirm: z.string() });

export async function signIn(formData: FormData): Promise<void> {
  const parsed = Credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const supabase = await createServerSupabase();
  const failed = !parsed.success || (await supabase.auth.signInWithPassword(parsed.data)).error !== null;
  redirect(failed ? "/login?failed=1" : "/");
}

export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

/** The TOTP challenge: one verified factor, one code, one result. */
export async function verifyTotp(formData: FormData): Promise<void> {
  const parsed = Code.safeParse({ code: formData.get("code") });
  if (!parsed.success) redirect("/login/mfa?failed=1");
  const supabase = await createServerSupabase();
  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp[0]; // `totp` lists verified factors only
  const failed = !factor || (await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data.code })).error !== null;
  redirect(failed ? "/login/mfa?failed=1" : "/");
}

/** Always the same answer, whether or not the address has an account. */
export async function requestPasswordReset(formData: FormData): Promise<void> {
  const parsed = Email.safeParse({ email: formData.get("email") });
  if (parsed.success) {
    const supabase = await createServerSupabase();
    const next = encodeURIComponent("/login/reset?step=complete");
    await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${siteUrl()}/auth/callback?next=${next}` });
  }
  redirect("/login/reset?sent=1");
}

/** Completes a reset: the callback has already exchanged the link for a session. */
export async function completePasswordReset(formData: FormData): Promise<void> {
  const parsed = NewPassword.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success || parsed.data.password !== parsed.data.confirm) redirect("/login/reset?step=complete&failed=1");
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  redirect(error ? "/login/reset?step=complete&failed=1" : "/");
}
