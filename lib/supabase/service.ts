/**
 * Service-role Supabase client — KERNEL-ONLY, SERVER-ONLY.
 *
 * The service role bypasses RLS entirely, so this key must never reach a
 * browser bundle. It is read from a non-`NEXT_PUBLIC_` variable precisely so a
 * client import fails loudly rather than shipping the key (SPEC §12).
 *
 * Only the cron routes and lib/jobs construct this (lint enforces it), and
 * the cron routes only AFTER `isCronAuthorized` has passed (plan §3.4).
 */
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";
import type { Database, Db } from "./types";

export function createServiceRoleClient(): Db {
  const { NEXT_PUBLIC_SUPABASE_URL: url } = publicEnv();
  const { SUPABASE_SERVICE_ROLE_KEY: key } = serverEnv();
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
