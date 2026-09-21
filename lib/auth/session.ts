/**
 * The Data Access Layer's one entry point (docs/milestone-3-plan.md
 * "Identity and sessions"): every page under `app/(app)/` and every server
 * action calls `requireUser()` FIRST, before reading a form field.
 *
 * `cache` memoises the verification for one render pass; a server action is
 * its own pass and verifies again. The proxy's redirect is optimistic; this
 * is the check that counts.
 */
import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { LOGIN_PATH, MFA_PATH, resolveAccess, type Identity } from "./access";

export interface Session {
  identity: Identity;
  /** The user's own RLS-scoped client. */
  client: SupabaseClient;
}

export const requireUser = cache(async (): Promise<Session> => {
  const client = await createServerSupabase();
  const access = await resolveAccess(client.auth);
  if (access.kind === "unauthenticated") redirect(LOGIN_PATH);
  if (access.kind === "mfa_required") redirect(MFA_PATH);
  return { identity: access.identity, client };
});

/** For actions that change the account's security posture (SPEC §9.6). */
export async function requireAal2(): Promise<Session | { reason: "aal2_required" }> {
  const session = await requireUser();
  if (session.identity.nextLevel === "aal2" && session.identity.currentLevel !== "aal2")
    return { reason: "aal2_required" };
  return session;
}
