/**
 * Session refresh, optimistic redirects and the security headers (Next 16
 * `proxy`; docs/milestone-3-plan.md "Identity and sessions"; MILESTONES.md
 * §4 decision 51).
 *
 * Runs on every matched request: `getUser()` verifies the session and lets
 * the SSR library rewrite a refreshed token into the response cookies; an
 * unauthenticated request for a data route goes to /login and an AAL1
 * session with a verified factor to /login/mfa. This is the optimistic
 * check — every page and action re-establishes identity through
 * `lib/auth/session.ts`, which is the one that counts.
 *
 * A fresh CSP nonce is generated per request and travels on the forwarded
 * request headers (`x-nonce` and the policy itself, which is how Next
 * injects it into the scripts it renders) and on the response.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { redirectFor, resolveAccess } from "@/lib/auth/access";
import { publicEnv } from "@/lib/env";
import { applySecurityHeaders, buildCsp, newNonce } from "@/lib/security/csp";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

const DEV = process.env.NODE_ENV === "development";

export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", buildCsp(nonce, { dev: DEV }));
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });

  let response = next();
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey } = publicEnv();
  const supabase = createServerClient<Database>(url, anonKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = next();
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
    applySecurityHeaders(redirected.headers, nonce, { dev: DEV });
    return redirected;
  }
  applySecurityHeaders(response.headers, nonce, { dev: DEV });
  return response;
}

export const config = {
  // Everything except Next internals, static files and the cron routes, which
  // authenticate with their own secret (lib/cron/auth.ts) and return JSON.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/cron).*)"],
};
