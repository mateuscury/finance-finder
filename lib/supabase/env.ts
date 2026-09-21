/**
 * The two PUBLIC Supabase variables every user-facing client needs. The
 * service-role key lives in `service.ts` and is deliberately not here.
 * Messages name variables, never values (SPEC §12).
 */
export function publicSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new Error("supabase: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required");
  return { url, anonKey };
}

/**
 * Where password-reset links land. Taken from configuration, never from the
 * request's Host header, so a spoofed header cannot poison a reset email.
 */
export function siteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) throw new Error("supabase: NEXT_PUBLIC_SITE_URL is required for password reset links");
  return url.replace(/\/$/, "");
}
