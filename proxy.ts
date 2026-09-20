/**
 * Session refresh and optimistic redirects (Next 16 `proxy`; docs/
 * milestone-3-plan.md "Identity and sessions").
 *
 * Runs on every matched request: `getUser()` verifies the session and lets
 * the SSR library rewrite a refreshed token into the response cookies; an
 * unauthenticated request for a data route goes to /login and an AAL1
 * session with a verified factor to /login/mfa. This is the optimistic
 * check — every page and action re-establishes identity through
 * `lib/auth/session.ts`, which is the one that counts.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { redirectFor, resolveAccess } from "@/lib/auth/access";
import { publicSupabaseEnv } from "@/lib/supabase/env";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = publicSupabaseEnv();
  const supabase = createServerClient(url, anonKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const access = await resolveAccess(supabase.auth);
  const target = redirectFor(request.nextUrl.pathname, access);
  if (target !== null) {
    const redirected = NextResponse.redirect(new URL(target, request.url));
    // Carry any refreshed session cookie onto the redirect.
    for (const cookie of response.cookies.getAll()) redirected.cookies.set(cookie);
    return redirected;
  }
  return response;
}

export const config = {
  // Everything except Next internals, static files and the cron routes, which
  // authenticate with their own secret (lib/cron/auth.ts).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/cron).*)"],
};
