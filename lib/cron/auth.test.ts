import { describe, expect, it } from "vitest";
import { isCronAuthorized } from "./auth";

const SECRET = "0123456789abcdef0123456789abcdef";

function request(authorization?: string): Request {
  return new Request("https://finance-finder.test/api/cron/prices", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("isCronAuthorized", () => {
  it("accepts the exact bearer token", () => {
    expect(isCronAuthorized(request(`Bearer ${SECRET}`), SECRET)).toBe(true);
  });

  it.each([undefined, "", "short"])("fails closed for a missing or weak configured secret", (secret) => {
    expect(isCronAuthorized(request(`Bearer ${String(secret)}`), secret)).toBe(false);
  });

  it.each([undefined, "Bearer wrong", SECRET, `bearer ${SECRET}`])(
    "rejects a missing or malformed authorization header",
    (authorization) => {
      expect(isCronAuthorized(request(authorization), SECRET)).toBe(false);
    },
  );
});
