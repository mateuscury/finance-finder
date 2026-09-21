import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { abortedSignal, testContext, textResponse } from "../../conformance/helpers";
import { FetchPointSchema, RefCoverageSchema } from "../../schema";
import { chooseRange, daysBetween, fetchBrapi, toSaoPauloDate } from "./brapi";

const TOKEN = "test-token";
const env = { BRAPI_TOKEN: TOKEN };
const NOW = "2026-09-06T12:00:00Z";

/** Bars anchored at midnight São Paulo, exactly as the live API returns them. */
const bar = (epochSeconds: number, close: string) =>
  `{"date":${epochSeconds},"open":1,"high":2,"low":0.5,"close":${close},"volume":10,"adjustedClose":999.99}`;

const quoteBody = (symbol: string, extra = "") =>
  `{"results":[{"symbol":"${symbol}","currency":"BRL","regularMarketPrice":148.3,"regularMarketTime":"2026-09-04T19:38:26.000Z"${extra}}],"requestedAt":"2026-09-06T21:00:00.000Z"}`;

const historyBody = (symbol: string, bars: string[]) =>
  `{"results":[{"symbol":"${symbol}","currency":"BRL","historicalDataPrice":[${bars.join(",")}]}]}`;

const ctx = (
  handler: (url: string, init?: { headers?: Record<string, string> }) => { status: number; body: string },
  opts: { env?: Record<string, string | undefined>; signal?: AbortSignal } = {},
) => {
  const seen: Array<{ url: string; headers?: Record<string, string> }> = [];
  const context = testContext({
    now: NOW,
    env: opts.env ?? env,
    signal: opts.signal,
    get: (url, init) => {
      seen.push({ url, headers: init?.headers });
      const r = handler(url, init);
      return textResponse(r.status, r.body);
    },
  });
  return { context, seen };
};

describe("brapi range selection", () => {
  it("never asks for a range the free plan rejects with HTTP 400", () => {
    // Verified live: limit.current = ["1d","5d","1mo","3mo"]; 6mo is a 400.
    for (const from of ["2026-09-06", "2026-09-02", "2026-08-20", "2026-06-20", "2020-01-01"]) {
      const { range } = chooseRange(from, "2026-09-06");
      expect(["1d", "5d", "1mo", "3mo"]).toContain(range);
    }
  });

  it("picks the smallest range that reaches back to `from`", () => {
    expect(chooseRange("2026-09-06", "2026-09-06")).toEqual({ range: "1d", truncated: false });
    expect(chooseRange("2026-09-02", "2026-09-06")).toEqual({ range: "5d", truncated: false });
    expect(chooseRange("2026-08-20", "2026-09-06")).toEqual({ range: "1mo", truncated: false });
    expect(chooseRange("2026-07-01", "2026-09-06")).toEqual({ range: "3mo", truncated: false });
  });

  it("flags truncation once the window predates the plan's 3-month cap", () => {
    expect(chooseRange("2026-01-01", "2026-09-06")).toEqual({ range: "3mo", truncated: true });
  });

  it("measures the span from today, because `range` is anchored at now, not at `to`", () => {
    expect(daysBetween("2026-09-01", "2026-09-06")).toBe(5);
    expect(daysBetween("2026-01-01", "2026-09-06")).toBe(248);
  });
});

describe("brapi observation dates", () => {
  it("dates a midnight-São Paulo bar on its own day", () => {
    // 1788231600 = 2026-09-01 00:00 in São Paulo (03:00 UTC).
    expect(toSaoPauloDate(1788231600 * 1000)).toBe("2026-09-01");
  });

  it("resolves the UTC boundary the way B3 does, not the way UTC does", () => {
    // 02:00 UTC is still the PREVIOUS day in São Paulo (23:00 UTC-3).
    expect(toSaoPauloDate(Date.parse("2026-09-02T02:00:00Z"))).toBe("2026-09-01");
    expect(new Date(Date.parse("2026-09-02T02:00:00Z")).toISOString().slice(0, 10)).toBe("2026-09-02");
    // ...and 03:00 UTC has rolled over into the new day.
    expect(toSaoPauloDate(Date.parse("2026-09-02T03:00:00Z"))).toBe("2026-09-02");
  });
});

describe("brapi adapter", () => {
  it("authenticates with a Bearer header and keeps the token out of the URL", async () => {
    const { context, seen } = ctx(() => ({ status: 200, body: quoteBody("HGLG11") }));
    await fetchBrapi({ capability: "spot", refs: ["HGLG11"] }, context);
    expect(seen[0].headers?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen[0].url).not.toContain(TOKEN);
    expect(seen[0].url).toBe("https://brapi.dev/api/quote/HGLG11");
  });

  it("makes no request and names the variable when the token is missing", async () => {
    const { context, seen } = ctx(() => ({ status: 200, body: quoteBody("HGLG11") }), { env: {} });
    const r = await fetchBrapi({ capability: "spot", refs: ["HGLG11"] }, context);
    expect(seen).toEqual([]);
    expect(r.points).toEqual([]);
    expect(r.warnings).toEqual(["brapi: BRAPI_TOKEN is not set; source disabled"]);
  });

  it("maps the index series to ^BVSP and IFIX.SA", async () => {
    const { context, seen } = ctx((url) => ({
      status: 200,
      body: historyBody(url.includes("BVSP") ? "^BVSP" : "IFIX.SA", [bar(1788231600, "185147.16")]),
    }));
    await fetchBrapi(
      { capability: "series", refs: ["br.ibovespa", "br.ifix"], from: "2026-09-01", to: "2026-09-06" },
      context,
    );
    expect(seen.map((s) => s.url)).toEqual([
      // 2026-09-01..2026-09-06 is 5 days, so "5d" is the smallest covering range.
      "https://brapi.dev/api/quote/%5EBVSP?range=5d&interval=1d",
      "https://brapi.dev/api/quote/IFIX.SA?range=5d&interval=1d",
    ]);
  });

  it("never sends start/end, which the API accepts and silently ignores", async () => {
    const { context, seen } = ctx(() => ({ status: 200, body: historyBody("HGLG11", [bar(1788231600, "147")]) }));
    await fetchBrapi({ capability: "historical", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-06" }, context);
    expect(seen[0].url).not.toMatch(/[?&](start|end)=/);
  });

  it("emits the actual close as an exact lexeme, never the adjusted close", async () => {
    const { context } = ctx(() => ({
      status: 200,
      body: historyBody("HGLG11", [bar(1788231600, "147"), bar(1788318000, "147.82")]),
    }));
    const r = await fetchBrapi({ capability: "historical", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-06" }, context);
    expect(r.points).toEqual([
      { ref: "HGLG11", date: "2026-09-01", value: "147", currency: "BRL" },
      { ref: "HGLG11", date: "2026-09-02", value: "147.82", currency: "BRL" },
    ]);
    // adjustedClose is 999.99 in every fixture bar; it must never appear.
    expect(r.points.map((p) => p.value)).not.toContain("999.99");
  });

  it("gives index series a null currency and holdings the quote currency", async () => {
    const { context } = ctx((url) => ({
      status: 200,
      body: historyBody(url.includes("BVSP") ? "^BVSP" : "HGLG11", [bar(1788231600, "100.5")]),
    }));
    const index = await fetchBrapi({ capability: "series", refs: ["br.ibovespa"], from: "2026-09-01", to: "2026-09-06" }, context);
    const fii = await fetchBrapi({ capability: "historical", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-06" }, context);
    expect(index.points[0].currency).toBeNull();
    expect(fii.points[0].currency).toBe("BRL");
  });

  it("serves an equity ticker through the same quote path as a FII (br.stock)", async () => {
    const { context, seen } = ctx((url) => ({ status: 200, body: quoteBody(url.includes("PETR4") ? "PETR4" : "HGLG11") }));
    const res = await fetchBrapi({ capability: "spot", refs: ["PETR4"] }, context);
    expect(seen[0].url).toBe("https://brapi.dev/api/quote/PETR4");
    expect(res.points).toEqual([{ ref: "PETR4", date: "2026-09-04", value: "148.3", currency: "BRL" }]);
    expect(res.warnings).toEqual([]);
  });

  it("enforces the requested window itself, since the API will not", async () => {
    const { context } = ctx(() => ({
      status: 200,
      body: historyBody("HGLG11", [bar(1788231600, "147"), bar(1788318000, "147.82"), bar(1788404400, "148.49")]),
    }));
    const r = await fetchBrapi({ capability: "historical", refs: ["HGLG11"], from: "2026-09-02", to: "2026-09-02" }, context);
    expect(r.points.map((p) => p.date)).toEqual(["2026-09-02"]);
  });

  it("reports the plan's history cap as uncovered instead of passing off a short series", async () => {
    const { context } = ctx(() => ({ status: 200, body: historyBody("HGLG11", [bar(1788231600, "147")]) }));
    const r = await fetchBrapi({ capability: "historical", refs: ["HGLG11"], from: "2026-01-01", to: "2026-09-06" }, context);
    expect(r.points).toHaveLength(1);
    expect(r.coverage?.[0]).toMatchObject({ complete: false, returned: { from: "2026-09-01", to: "2026-09-01" } });
    expect(r.warnings.some((w) => /3mo limit is unavailable/.test(w))).toBe(true);
  });

  it("certifies a window it could fully reach", async () => {
    const { context } = ctx(() => ({ status: 200, body: historyBody("HGLG11", [bar(1788231600, "147")]) }));
    const r = await fetchBrapi({ capability: "historical", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-06" }, context);
    expect(r.coverage?.[0].complete).toBe(true);
  });

  it("distinguishes a rejected token, a plan limit and a generic failure", async () => {
    const cases: Array<[number, RegExp]> = [
      [401, /BRAPI_TOKEN was rejected/],
      [403, /BRAPI_TOKEN was rejected/],
      [400, /exceeds the current plan's history limit/],
      [500, /HTTP 500/],
      [429, /HTTP 429/],
    ];
    for (const [status, pattern] of cases) {
      const { context } = ctx(() => ({ status, body: "{}" }));
      const r = await fetchBrapi({ capability: "historical", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-06" }, context);
      expect(r.points).toEqual([]);
      expect(r.coverage?.[0].complete).toBe(false);
      expect(r.warnings.some((w) => pattern.test(w)), `${status}: ${r.warnings.join("|")}`).toBe(true);
    }
  });

  it("refuses a payload that answers a different symbol", async () => {
    const { context } = ctx(() => ({ status: 200, body: historyBody("KNRI11", [bar(1788231600, "147")]) }));
    const r = await fetchBrapi({ capability: "historical", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-06" }, context);
    expect(r.points).toEqual([]);
    expect(r.warnings.some((w) => /different symbol/.test(w))).toBe(true);
  });

  it("handles an empty result set and an unparsable body without throwing", async () => {
    for (const body of ['{"results":[]}', "not json", '{"results":[{"symbol":"HGLG11"}]}']) {
      const { context } = ctx(() => ({ status: 200, body }));
      const r = await fetchBrapi({ capability: "historical", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-06" }, context);
      expect(r.points).toEqual([]);
      expect(r.coverage?.[0].complete).toBe(false);
    }
  });

  it("reads a spot quote from regularMarketPrice and dates it in São Paulo", async () => {
    const { context } = ctx(() => ({ status: 200, body: quoteBody("HGLG11") }));
    const r = await fetchBrapi({ capability: "spot", refs: ["HGLG11"] }, context);
    expect(r.points).toEqual([{ ref: "HGLG11", date: "2026-09-04", value: "148.3", currency: "BRL" }]);
    // `spot` carries no interval, so it declares no coverage.
    expect(r.coverage).toBeUndefined();
  });

  it("never dates a spot point in the future", async () => {
    const future = quoteBody("HGLG11").replace("2026-09-04T19:38:26.000Z", "2027-01-01T12:00:00.000Z");
    const { context } = ctx(() => ({ status: 200, body: future }));
    const r = await fetchBrapi({ capability: "spot", refs: ["HGLG11"] }, context);
    expect(r.points[0].date).toBe("2026-09-06");
  });

  it("stops requesting once the budget signal has aborted", async () => {
    const { context, seen } = ctx(() => ({ status: 200, body: quoteBody("HGLG11") }), { signal: abortedSignal() });
    const r = await fetchBrapi({ capability: "historical", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-06" }, context);
    expect(seen).toEqual([]);
    expect(r.coverage?.[0].complete).toBe(false);
  });

  it("rejects an unsupported capability", async () => {
    const { context } = ctx(() => ({ status: 200, body: "{}" }));
    const r = await fetchBrapi({ capability: "fx", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-06" }, context);
    expect(r.warnings[0]).toMatch(/unsupported capability/);
  });

  it("property: every emitted point satisfies the kernel output contract", async () => {
    const barGen = fc
      .tuple(fc.integer({ min: 0, max: 5 }), fc.nat(99999), fc.nat(99))
      .map(([d, w, c]) => bar(1788231600 + d * 86_400, `${w + 1}.${String(c).padStart(2, "0")}`));
    await fc.assert(
      fc.asyncProperty(fc.array(barGen, { maxLength: 25 }), async (bars) => {
        const { context } = ctx(() => ({ status: 200, body: historyBody("HGLG11", bars) }));
        const r = await fetchBrapi(
          { capability: "historical", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-06" },
          context,
        );
        for (const p of r.points) {
          expect(FetchPointSchema.safeParse(p).success).toBe(true);
          expect(p.currency).toBe("BRL");
          expect(p.date >= "2026-09-01" && p.date <= "2026-09-06").toBe(true);
        }
        const keys = r.points.map((p) => `${p.ref}|${p.date}`);
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });
});

describe("brapi declares its availability floor (backfill must not loop)", () => {
  it("reports the floor even when the whole requested window is unreachable", async () => {
    // The looping case: an FII bought more than 3 months ago. The scheduler
    // asks for an old 90-day chunk; brapi can only serve the last 3 months, so
    // every returned bar is filtered away and NO points come back. Without an
    // explicit floor this is indistinguishable from a transient failure and the
    // same unreachable chunk is requested forever.
    const { context } = ctx(() => ({
      status: 200,
      body: historyBody("HGLG11", [bar(1788231600, "147"), bar(1788318000, "147.82")]),
    }));
    const r = await fetchBrapi(
      { capability: "historical", refs: ["HGLG11"], from: "2025-01-01", to: "2025-04-01" },
      context,
    );
    expect(r.points).toEqual([]);
    const [coverage] = r.coverage!;
    expect(coverage.complete).toBe(false);
    expect(coverage.returned).toBeNull();
    // 1788231600 = 2026-09-01 São Paulo: the oldest bar actually served.
    expect(coverage.unavailableBefore).toBe("2026-09-01");
  });

  it("declares no floor when the window was fully reachable", async () => {
    const { context } = ctx(() => ({ status: 200, body: historyBody("HGLG11", [bar(1788231600, "147")]) }));
    const r = await fetchBrapi({ capability: "historical", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-06" }, context);
    expect(r.coverage![0].complete).toBe(true);
    expect(r.coverage![0].unavailableBefore).toBeUndefined();
  });

  it("declares no floor when the failure is transient, so nothing is written off", async () => {
    // A 5xx must NOT be mistaken for a structural limit: the history is still
    // there, we just could not read it this time.
    const { context } = ctx(() => ({ status: 503, body: "{}" }));
    const r = await fetchBrapi({ capability: "historical", refs: ["HGLG11"], from: "2025-01-01", to: "2025-04-01" }, context);
    expect(r.coverage![0].unavailableBefore).toBeUndefined();
    expect(r.coverage![0].complete).toBe(false);
  });

  it("keeps the floor consistent with the points it did return", async () => {
    const { context } = ctx(() => ({
      status: 200,
      body: historyBody("HGLG11", [bar(1788231600, "147"), bar(1788318000, "147.82")]),
    }));
    const r = await fetchBrapi(
      { capability: "historical", refs: ["HGLG11"], from: "2025-01-01", to: "2026-09-06" },
      context,
    );
    const [coverage] = r.coverage!;
    expect(coverage.returned).toEqual({ from: "2026-09-01", to: "2026-09-02" });
    // The schema forbids returned data predating the declared floor.
    expect(coverage.unavailableBefore).toBe("2026-09-01");
    expect(RefCoverageSchema.safeParse(coverage).success).toBe(true);
  });
});
