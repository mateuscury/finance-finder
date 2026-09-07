import { describe, expect, it } from "vitest";
import { createRedactor, placeholder } from "./redact";

// Deliberately fabricated values. A real credential must never appear in a
// test file: the repository is public, and the test would publish it.
const env = { BRAPI_TOKEN: "fake-token-not-a-real-key", OTHER: "s3cret-value-long" };

describe("createRedactor", () => {
  const r = createRedactor(env, ["BRAPI_TOKEN", "OTHER"]);

  it("replaces a raw secret anywhere in the text", () => {
    expect(r.text("https://x/api?token=fake-token-not-a-real-key&a=1")).toBe(
      "https://x/api?token=<REDACTED:BRAPI_TOKEN>&a=1",
    );
    expect(r.text("boom: fake-token-not-a-real-key failed")).not.toContain("fake-token-not-a-real-key");
  });

  it("replaces the URL-encoded form too", () => {
    const encoded = createRedactor({ K: "a b/c+d=" }, ["K"]);
    expect(encoded.text(`x=${encodeURIComponent("a b/c+d=")}`)).toBe("x=<REDACTED:K>");
  });

  it("replaces every occurrence, not just the first", () => {
    expect(r.text("fake-token-not-a-real-key fake-token-not-a-real-key")).toBe(
      `${placeholder("BRAPI_TOKEN")} ${placeholder("BRAPI_TOKEN")}`,
    );
  });

  it("normalises Authorization even when the value is not a declared variable", () => {
    const headers = r.headers({ Authorization: "Bearer some-unexpected-credential", accept: "application/json" });
    expect(headers.authorization).toBe("Bearer <REDACTED:SECRET>");
    expect(headers.accept).toBe("application/json");
  });

  it("names the variable when the Authorization value is a declared secret", () => {
    expect(r.headers({ authorization: `Bearer ${env.BRAPI_TOKEN}` }).authorization).toBe(
      "Bearer <REDACTED:BRAPI_TOKEN>",
    );
  });

  it("lower-cases header names so matching is stable", () => {
    expect(Object.keys(r.headers({ "Accept-Encoding": "gzip" }))).toEqual(["accept-encoding"]);
  });

  it("ignores absent and implausibly short values rather than corrupting text", () => {
    const weak = createRedactor({ EMPTY: "", SHORT: "ab" }, ["EMPTY", "SHORT", "MISSING"]);
    expect(weak.text("ab cab")).toBe("ab cab");
  });

  it("prefers the longest match when two secrets overlap", () => {
    const overlap = createRedactor({ LONG: "abcdef123456", SHORT_ONE: "abcdef" }, ["SHORT_ONE", "LONG"]);
    expect(overlap.text("abcdef123456")).toBe(placeholder("LONG"));
  });
});
