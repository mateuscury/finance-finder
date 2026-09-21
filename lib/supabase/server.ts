/**
 * The user's own Supabase client for Server Components, Server Actions and
 * Route Handlers (docs/milestone-3-plan.md "Identity and sessions").
 *
 * ANON key + the request's cookies: RLS scopes every read and write to the
 * signed-in user. A new client per request, never shared. Cookies are
 * `httpOnly` — nothing in the browser ever reads the session, because every
 * Supabase call in this app happens on the server (ARCHITECTURE §4.6); a
 * Server Component cannot set cookies, so a refresh that happens during a
 * render is written by `proxy.ts` on the next request instead.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import type { Database, Db } from "./types";

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

export async function createServerSupabase(): Promise<Db> {
  const cookieStore = await cookies();
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey } = publicEnv();
  return createServerClient<Database>(url, anonKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, which may not set cookies. The
          // proxy refreshes the session on the next request.
        }
      },
    },
  });
}
