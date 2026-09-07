/**
 * Service-role Supabase client — KERNEL-ONLY, SERVER-ONLY.
 *
 * The service role bypasses RLS entirely, so this key must never reach a
 * browser bundle. It is read from a non-`NEXT_PUBLIC_` variable precisely so a
 * client import fails loudly rather than shipping the key (SPEC §12).
 *
 * Only the cron routes construct this, and only AFTER `isCronAuthorized`
 * has passed (plan §3.4).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Names only, never values.
    throw new Error("service client: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
