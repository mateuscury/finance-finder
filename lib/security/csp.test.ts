import { describe, expect, it } from "vitest";
import { applySecurityHeaders, buildCsp, newNonce, securityHeaders } from "./csp";

describe("csp", () => {
  it("builds the production policy with the nonce and no eval or websocket allowance", () => {
    expect(buildCsp("abc", { dev: false })).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests",
    );
  });

  it("adds unsafe-eval and websockets in development only, and drops upgrade-insecure-requests", () => {
    const dev = buildCsp("abc", { dev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("connect-src 'self' ws: wss:");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("never allows a third-party origin", () => {
    for (const dev of [true, false]) expect(buildCsp("n", { dev })).not.toMatch(/https?:\/\//);
  });

  it("generates a base64 nonce of 16 bytes that differs per call", () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });

  it("sends HSTS outside development only", () => {
    expect(securityHeaders({ dev: true })["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders({ dev: false })["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
  });

  it("applies the whole set to a Headers object", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "abc", { dev: false });
    expect(headers.get("Content-Security-Policy")).toContain("'nonce-abc'");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
  });
});
