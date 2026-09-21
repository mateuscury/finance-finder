/**
 * Content Security Policy and the per-request nonce (MILESTONES.md §4
 * decision 51; SPEC §12.1 "no third parties by default").
 *
 * The policy is strict because the app has no third-party origin at all:
 * fonts are self-hosted through next/font, the only images are the TOTP
 * enrolment QR (a data: URI) and the app's own, and every Supabase call
 * happens on the server. `script-src` is nonce-based with 'strict-dynamic'
 * so Next's own scripts run and an injected one does not; `style-src`
 * allows inline styles because React and Recharts set `style` attributes,
 * which a nonce cannot cover.
 *
 * `proxy.ts` sets the header on the request (so Next injects the nonce
 * into the scripts it renders) and on the response.
 */
import { randomBytes } from "node:crypto";

export interface CspOptions {
  /** Development needs 'unsafe-eval' for React's error overlay and ws: for HMR. */
  dev: boolean;
}

export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

export function buildCsp(nonce: string, { dev }: CspOptions): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  if (!dev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/**
 * The static headers every response carries (next.config.ts adds the same
 * set for responses the proxy does not see). HSTS only outside development:
 * a `localhost` origin must not be pinned to https.
 */
export function securityHeaders({ dev }: CspOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Frame-Options": "DENY",
  };
  if (!dev) headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  return headers;
}

/** Applies the CSP and the static headers to a response. Pure over the Headers object. */
export function applySecurityHeaders(headers: Headers, nonce: string, options: CspOptions): void {
  headers.set("Content-Security-Policy", buildCsp(nonce, options));
  for (const [name, value] of Object.entries(securityHeaders(options))) headers.set(name, value);
}
