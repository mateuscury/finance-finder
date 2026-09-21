import { describe, expect, it, vi } from "vitest";
import { createPackHttp, MAX_ATTEMPTS, parseRetryAfter, TokenBucket, USER_AGENT } from "./http";
import type { Exchange } from "./fixtures";

const source = { id: "br.test", rateLimit: { requests: 2, perSeconds: 1 }, envVars: ["TEST_TOKEN"] };

/** A controllable clock so nothing in these tests waits on real time. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function okResponse(body = "{}", status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

describe("TokenBucket", () => {
  it("allows a burst up to capacity, then makes the next caller wait", () => {
    const c = clock();
    const b = new TokenBucket(2, 1, c.now);
    expect(b.waitMs()).toBe(0);
    b.take();
    expect(b.waitMs()).toBe(0);
    b.take();
    expect(b.waitMs()).toBeGreaterThan(0);
  });

  it("refills continuously rather than in whole-window steps", () => {
    const c = clock();
    const b = new TokenBucket(2, 1, c.now);
    b.take();
    b.take();
    c.advance(500); // half a second at 2/second == one token
    expect(b.waitMs()).toBe(0);
  });

  it("never banks more than capacity, however long it idles", () => {
    const c = clock();
    const b = new TokenBucket(2, 1, c.now);
    c.advance(60_000); // a minute of idling must not buy 120 requests
    // waitMs() is what refills, and callers must consult it before take().
    for (let i = 0; i < 2; i++) {
      expect(b.waitMs()).toBe(0);
      b.take();
    }
    expect(b.waitMs()).toBeGreaterThan(0);
  });
});

describe("parseRetryAfter", () => {
  it("reads delay-seconds", () => {
    expect(parseRetryAfter("120", 0)).toBe(120_000);
    expect(parseRetryAfter(" 5 ", 0)).toBe(5_000);
  });

  it("reads an HTTP-date, relative to now", () => {
    const now = Date.parse("2026-09-06T12:00:00Z");
    expect(parseRetryAfter("Sun, 06 Sep 2026 12:00:30 GMT", now)).toBe(30_000);
    // A date already in the past means "retry now", not a negative sleep.
    expect(parseRetryAfter("Sun, 06 Sep 2026 11:59:00 GMT", now)).toBe(0);
  });

  it("returns null for an absent or unparsable value", () => {
    expect(parseRetryAfter(undefined, 0)).toBeNull();
    expect(parseRetryAfter("soon", 0)).toBeNull();
  });
});

describe("createPackHttp — live", () => {
  const base = (over: Partial<Parameters<typeof createPackHttp>[0]> = {}) => {
    const c = clock();
    return {
      c,
      opts: {
        source,
        mode: "live" as const,
        signal: new AbortController().signal,
        deadline: c.now() + 60_000,
        env: { TEST_TOKEN: "super-secret-value" },
        now: c.now,
        sleep: async (ms: number) => void c.advance(ms),
        ...over,
      },
    };
  };

  it("sends the project user-agent", async () => {
    const seen: Array<Record<string, string>> = [];
    const { opts } = base({
      fetchImpl: (async (_u: string, init: RequestInit) => {
        seen.push(init.headers as Record<string, string>);
        return okResponse();
      }) as unknown as typeof fetch,
    });
    await createPackHttp(opts).http.get("https://example.test/a");
    expect(seen[0]["user-agent"]).toBe(USER_AGENT);
  });

  it("serves one body read to both text() and json()", async () => {
    const { opts } = base({ fetchImpl: (async () => okResponse('{"a":1}')) as unknown as typeof fetch });
    const res = await createPackHttp(opts).http.get("https://example.test/a");
    expect(await res.text()).toBe('{"a":1}');
    expect(await res.json()).toEqual({ a: 1 });
    expect(await res.text()).toBe('{"a":1}');
  });

  it("retries a 429 up to the attempt cap and consumes a token per attempt", async () => {
    let calls = 0;
    const { opts } = base({
      fetchImpl: (async () => {
        calls++;
        return okResponse("slow down", 429);
      }) as unknown as typeof fetch,
    });
    const handle = createPackHttp(opts);
    const res = await handle.http.get("https://example.test/a");
    expect(calls).toBe(MAX_ATTEMPTS);
    expect(res.status).toBe(429);
    expect(handle.attempts).toHaveLength(MAX_ATTEMPTS);
    expect(handle.attempts.every((a) => a.outcome === "retryable")).toBe(true);
  });

  it("retries a 5xx and returns the first success", async () => {
    let calls = 0;
    const { opts } = base({
      fetchImpl: (async () =>
        ++calls < 3 ? okResponse("boom", 503) : okResponse('{"ok":true}')) as unknown as typeof fetch,
    });
    const res = await createPackHttp(opts).http.get("https://example.test/a");
    expect(calls).toBe(3);
    expect(res.status).toBe(200);
  });

  it("does not retry a 404", async () => {
    let calls = 0;
    const { opts } = base({
      fetchImpl: (async () => {
        calls++;
        return okResponse("nope", 404);
      }) as unknown as typeof fetch,
    });
    expect((await createPackHttp(opts).http.get("https://example.test/a")).status).toBe(404);
    expect(calls).toBe(1);
  });

  it("honours Retry-After instead of its own backoff", async () => {
    const slept: number[] = [];
    const c = clock();
    let calls = 0;
    const handle = createPackHttp({
      source,
      mode: "live",
      signal: new AbortController().signal,
      deadline: c.now() + 600_000,
      now: c.now,
      sleep: async (ms: number) => {
        slept.push(ms);
        c.advance(ms);
      },
      fetchImpl: (async () =>
        ++calls < 2 ? okResponse("wait", 429, { "retry-after": "7" }) : okResponse()) as unknown as typeof fetch,
    });
    await handle.http.get("https://example.test/a");
    expect(slept).toContain(7000);
  });

  it("stops retrying rather than sleeping past the deadline", async () => {
    const c = clock();
    let calls = 0;
    const handle = createPackHttp({
      source,
      mode: "live",
      signal: new AbortController().signal,
      // Only 1s left: a 60s Retry-After must not be honoured.
      deadline: c.now() + 1_000,
      now: c.now,
      sleep: async (ms: number) => void c.advance(ms),
      fetchImpl: (async () => {
        calls++;
        return okResponse("wait", 429, { "retry-after": "60" });
      }) as unknown as typeof fetch,
    });
    const res = await handle.http.get("https://example.test/a");
    expect(res.status).toBe(429);
    expect(calls).toBe(1);
  });

  it("clips the request to the remaining budget and aborts past the deadline", async () => {
    const c = clock();
    const handle = createPackHttp({
      source,
      mode: "live",
      signal: new AbortController().signal,
      deadline: c.now() - 1, // already past
      now: c.now,
      fetchImpl: (async () => okResponse()) as unknown as typeof fetch,
    });
    await expect(handle.http.get("https://example.test/a")).rejects.toThrow(/aborted/);
  });

  it("really cancels the in-flight request when the budget signal aborts", async () => {
    const controller = new AbortController();
    const c = clock();
    let sawAbort = false;
    const handle = createPackHttp({
      source,
      mode: "live",
      signal: controller.signal,
      deadline: c.now() + 60_000,
      now: c.now,
      // A Promise.race would resolve early while this kept running; the real
      // request must observe the abort.
      fetchImpl: ((_u: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            sawAbort = true;
            reject(new Error("AbortError"));
          });
          controller.abort();
        })) as unknown as typeof fetch,
    });
    await expect(handle.http.get("https://example.test/a")).rejects.toThrow();
    expect(sawAbort).toBe(true);
  });

  it("never lets a secret escape through a thrown error", async () => {
    const c = clock();
    const handle = createPackHttp({
      source,
      mode: "live",
      signal: new AbortController().signal,
      deadline: c.now() + 60_000,
      env: { TEST_TOKEN: "super-secret-value" },
      now: c.now,
      fetchImpl: (async () => {
        throw new Error("connect ECONNREFUSED https://example.test/a?token=super-secret-value");
      }) as unknown as typeof fetch,
    });
    await expect(handle.http.get("https://example.test/a?token=super-secret-value")).rejects.toThrow(
      /request failed for 'br.test'/,
    );
    await handle.http.get("https://example.test/a?token=super-secret-value").catch((e: Error) => {
      expect(e.message).not.toContain("super-secret-value");
    });
  });
});

describe("createPackHttp — record", () => {
  it("captures a sanitized transcript with the secret removed from url, headers and body", async () => {
    const c = clock();
    const handle = createPackHttp({
      source,
      mode: "record",
      signal: new AbortController().signal,
      deadline: c.now() + 60_000,
      env: { TEST_TOKEN: "super-secret-value" },
      now: c.now,
      sleep: async () => {},
      fetchImpl: (async () => okResponse('{"echo":"super-secret-value"}')) as unknown as typeof fetch,
    });
    await handle.http.get("https://example.test/a?token=super-secret-value", {
      headers: { authorization: "Bearer super-secret-value" },
    });
    const [exchange] = handle.recorded;
    expect(exchange.request.url).toBe("https://example.test/a?token=<REDACTED:TEST_TOKEN>");
    expect(exchange.request.headers.authorization).toBe("Bearer <REDACTED:TEST_TOKEN>");
    expect(exchange.response.body).toBe('{"echo":"<REDACTED:TEST_TOKEN>"}');
    expect(JSON.stringify(handle.recorded)).not.toContain("super-secret-value");
  });

  it("records every attempt of a retried request", async () => {
    const c = clock();
    const handle = createPackHttp({
      source,
      mode: "record",
      signal: new AbortController().signal,
      deadline: c.now() + 600_000,
      now: c.now,
      sleep: async (ms: number) => void c.advance(ms),
      fetchImpl: (async () => okResponse("boom", 503)) as unknown as typeof fetch,
    });
    await handle.http.get("https://example.test/a");
    expect(handle.recorded).toHaveLength(MAX_ATTEMPTS);
  });
});

describe("createPackHttp — replay", () => {
  const exchange = (url: string, status = 200, body = "{}"): Exchange => ({
    request: { method: "GET", url, headers: { accept: "application/json" } },
    response: { status, headers: {}, body },
  });

  const replay = (exchanges: Exchange[], fetchImpl?: typeof fetch) =>
    createPackHttp({
      source,
      mode: "replay",
      signal: new AbortController().signal,
      deadline: Number.MAX_SAFE_INTEGER,
      exchanges,
      now: () => 0,
      fetchImpl:
        fetchImpl ??
        ((() => {
          throw new Error("replay must not touch the network");
        }) as unknown as typeof fetch),
    });

  it("serves recorded responses in order without any network call", async () => {
    const handle = replay([exchange("https://a.test/1"), exchange("https://a.test/2", 200, '{"n":2}')]);
    expect((await handle.http.get("https://a.test/1", { headers: { accept: "application/json" } })).status).toBe(200);
    expect(await (await handle.http.get("https://a.test/2", { headers: { accept: "application/json" } })).text()).toBe(
      '{"n":2}',
    );
    handle.assertFullyConsumed();
  });

  it("rejects a changed URL", async () => {
    const handle = replay([exchange("https://a.test/1")]);
    await expect(
      handle.http.get("https://a.test/CHANGED", { headers: { accept: "application/json" } }),
    ).rejects.toThrow(/does not match the recording/);
  });

  it("rejects a changed order", async () => {
    const handle = replay([exchange("https://a.test/1"), exchange("https://a.test/2")]);
    await expect(handle.http.get("https://a.test/2", { headers: { accept: "application/json" } })).rejects.toThrow(
      /does not match the recording/,
    );
  });

  it("rejects an extra request beyond the transcript", async () => {
    const handle = replay([exchange("https://a.test/1")]);
    await handle.http.get("https://a.test/1", { headers: { accept: "application/json" } });
    await expect(handle.http.get("https://a.test/1", { headers: { accept: "application/json" } })).rejects.toThrow(
      /unexpected extra request/,
    );
  });

  it("rejects an unused exchange", async () => {
    const handle = replay([exchange("https://a.test/1"), exchange("https://a.test/2")]);
    await handle.http.get("https://a.test/1", { headers: { accept: "application/json" } });
    expect(() => handle.assertFullyConsumed()).toThrow(/never requested/);
  });

  it("rejects a changed matched header", async () => {
    const handle = replay([exchange("https://a.test/1")]);
    await expect(handle.http.get("https://a.test/1", { headers: { accept: "text/csv" } })).rejects.toThrow(
      /header 'accept' does not match/,
    );
  });

  it("exhausts a recorded 429 instantly, with no real sleeping", async () => {
    const sleep = vi.fn(async () => {});
    const handle = createPackHttp({
      source,
      mode: "replay",
      signal: new AbortController().signal,
      deadline: Number.MAX_SAFE_INTEGER,
      exchanges: [
        exchange("https://a.test/1", 429, "slow"),
        exchange("https://a.test/1", 429, "slow"),
        exchange("https://a.test/1", 429, "slow"),
      ],
      now: () => 0,
      sleep,
      fetchImpl: (() => {
        throw new Error("no network");
      }) as unknown as typeof fetch,
    });
    const started = Date.now();
    const res = await handle.http.get("https://a.test/1", { headers: { accept: "application/json" } });
    expect(res.status).toBe(429);
    expect(Date.now() - started).toBeLessThan(200);
    handle.assertFullyConsumed();
  });

  it("matches a request whose secret redacts to the recorded placeholder", async () => {
    const handle = createPackHttp({
      source,
      mode: "replay",
      signal: new AbortController().signal,
      deadline: Number.MAX_SAFE_INTEGER,
      env: { TEST_TOKEN: "fixture-token-value" },
      exchanges: [
        {
          request: {
            method: "GET",
            url: "https://a.test/1",
            headers: { authorization: "Bearer <REDACTED:TEST_TOKEN>" },
          },
          response: { status: 200, headers: {}, body: "{}" },
        },
      ],
      now: () => 0,
      fetchImpl: (() => {
        throw new Error("no network");
      }) as unknown as typeof fetch,
    });
    const res = await handle.http.get("https://a.test/1", {
      headers: { authorization: "Bearer fixture-token-value" },
    });
    expect(res.status).toBe(200);
    handle.assertFullyConsumed();
  });
});

describe("createPackHttp — secrets on the wire vs in the recording", () => {
  it("sends the real credential upstream but records only the placeholder", async () => {
    // Regression guard: redacting the OUTGOING headers made every authenticated
    // recording capture a 401, because the API received the placeholder.
    const sent: Array<Record<string, string>> = [];
    const c = clock();
    const handle = createPackHttp({
      source,
      mode: "record",
      signal: new AbortController().signal,
      deadline: c.now() + 60_000,
      env: { TEST_TOKEN: "super-secret-value" },
      now: c.now,
      sleep: async () => {},
      fetchImpl: (async (_u: string, init: RequestInit) => {
        sent.push(init.headers as Record<string, string>);
        return okResponse('{"ok":true}');
      }) as unknown as typeof fetch,
    });
    await handle.http.get("https://example.test/a", { headers: { authorization: "Bearer super-secret-value" } });

    expect(sent[0].authorization).toBe("Bearer super-secret-value");
    expect(handle.recorded[0].request.headers.authorization).toBe("Bearer <REDACTED:TEST_TOKEN>");
  });

  it("sends the real URL upstream but records the redacted one", async () => {
    const urls: string[] = [];
    const c = clock();
    const handle = createPackHttp({
      source,
      mode: "record",
      signal: new AbortController().signal,
      deadline: c.now() + 60_000,
      env: { TEST_TOKEN: "super-secret-value" },
      now: c.now,
      sleep: async () => {},
      fetchImpl: (async (u: string) => {
        urls.push(u);
        return okResponse();
      }) as unknown as typeof fetch,
    });
    await handle.http.get("https://example.test/a?token=super-secret-value");
    expect(urls[0]).toBe("https://example.test/a?token=super-secret-value");
    expect(handle.recorded[0].request.url).toBe("https://example.test/a?token=<REDACTED:TEST_TOKEN>");
  });
});
