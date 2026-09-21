/**
 * The kernel `PackHttp` implementation (PACKS.md §7 rule 1, plan §2.1).
 *
 * Packs may not call global `fetch`; they get this instead, so rate limiting,
 * retries, deadlines, redaction and fixture record/replay are enforced in ONE
 * place rather than re-implemented (differently) by every adapter.
 *
 * Three modes:
 *  - `live`    real network, token bucket, retries, deadline-aware aborts
 *  - `record`  identical to live, plus a sanitized transcript for the recorder
 *  - `replay`  strictly consumes a recorded transcript, never touches the
 *              network, and uses injected clock/sleep so retry cases are instant
 *
 * SCOPE NOTE: the token bucket is process-local. It is NOT a distributed limit,
 * and two concurrent serverless instances would each hold their own. That is
 * acceptable here precisely because ingestion is a SINGLE scheduled invocation
 * (PACKS.md §10); an upstream 429 remains the final authority either way.
 *
 * LOGGING BOUNDARY: telemetry carries source id, attempt, status and duration
 * only — never a URL, header, body, ref or value (CLAUDE.md non-negotiables).
 */
import type { PackHttp, PackHttpResponse, PriceSource } from "@/packs/types";
import { createRedactor, type Redactor } from "./redact";
import type { Exchange } from "./fixtures";

export const USER_AGENT = "finance-finder/0.1 (+https://github.com/mateuscury/finance-finder)";
/** One initial try plus at most two retries. */
export const MAX_ATTEMPTS = 3;
const RETRYABLE = (status: number) => status === 429 || (status >= 500 && status < 600);
/** Backoff before attempt 2 and attempt 3, when no Retry-After is supplied. */
const BACKOFF_MS = [500, 1500];

export type HttpMode = "live" | "record" | "replay";

/** Structured, value-free record of one HTTP attempt. */
export interface HttpAttempt {
  sourceId: string;
  attempt: number;
  status: number | null;
  durationMs: number;
  outcome: "ok" | "retryable" | "error" | "aborted";
}

export interface CreatePackHttpOptions {
  source: Pick<PriceSource, "id" | "rateLimit" | "envVars">;
  mode: HttpMode;
  /** Aborted when this source's slice of the invocation budget is spent. */
  signal: AbortSignal;
  /** Epoch ms after which no new request or sleep may start. */
  deadline: number;
  /** Values used to build the redactor; only declared vars are considered. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Required in `replay`: the transcript to consume, in order. */
  exchanges?: readonly Exchange[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  onAttempt?: (attempt: HttpAttempt) => void;
}

export interface PackHttpHandle {
  http: PackHttp;
  /** Sanitized transcript collected in `record` mode. */
  recorded: Exchange[];
  /** Telemetry for every attempt, for the run summary. */
  attempts: HttpAttempt[];
  /**
   * Replay only: throw if the transcript was not fully consumed. An unused
   * exchange means the adapter stopped making a request it used to make.
   */
  assertFullyConsumed(): void;
}

/**
 * Process-local token bucket. Refills continuously rather than in steps, so a
 * source declared at 10 requests/second does not stall for a whole second
 * after a burst.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly perSeconds: number,
    private readonly now: () => number,
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = Math.max(0, t - this.lastRefill);
    this.lastRefill = t;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.capacity) / (this.perSeconds * 1000));
  }

  /** Milliseconds to wait before a token is available; 0 when one is ready. */
  waitMs(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const msPerToken = (this.perSeconds * 1000) / this.capacity;
    return Math.ceil((1 - this.tokens) * msPerToken);
  }

  take(): void {
    this.tokens -= 1;
  }
}

/** Both documented Retry-After forms: delay-seconds and an HTTP-date. */
export function parseRetryAfter(value: string | undefined, nowMs: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

class AbortedError extends Error {
  constructor() {
    super("pack http: aborted");
  }
}

/** One body read, served to both `text()` and `json()`. */
function toResponse(status: number, headers: Record<string, string>, body: string): PackHttpResponse {
  return {
    status,
    headers,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  };
}

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

/** Only the response headers replay and retry logic actually need. */
const KEPT_RESPONSE_HEADERS = ["content-type", "retry-after"];

export function createPackHttp(options: CreatePackHttpOptions): PackHttpHandle {
  const {
    source,
    mode,
    signal,
    deadline,
    env = {},
    exchanges = [],
    now = () => Date.now(),
    fetchImpl = fetch,
    onAttempt,
  } = options;
  // In replay nothing may actually sleep: a 429 fixture must exhaust its
  // retries instantly and deterministically.
  const sleep =
    options.sleep ?? (mode === "replay" ? async () => {} : (ms: number) => new Promise((r) => setTimeout(r, ms)));

  const redactor: Redactor = createRedactor(env, source.envVars ?? Object.keys(env));
  const bucket = new TokenBucket(source.rateLimit.requests, source.rateLimit.perSeconds, now);
  const recorded: Exchange[] = [];
  const attempts: HttpAttempt[] = [];
  let cursor = 0;

  const note = (attempt: HttpAttempt) => {
    attempts.push(attempt);
    onAttempt?.(attempt);
  };

  const remaining = () => deadline - now();

  async function waitForToken(): Promise<void> {
    const wait = bucket.waitMs();
    if (wait > 0) {
      // Waiting past the deadline would guarantee an aborted request; fail now
      // and leave the budget to the next source.
      if (wait >= remaining()) throw new AbortedError();
      await sleep(wait);
    }
    bucket.take();
  }

  async function performLive(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const timeLeft = remaining();
    if (timeLeft <= 0) throw new AbortedError();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    // A real cancel, not a Promise.race: the underlying request must actually
    // stop, or it keeps consuming the invocation after we have moved on.
    const timer = setTimeout(() => controller.abort(), timeLeft);
    try {
      const res = await fetchImpl(url, { headers, signal: controller.signal, redirect: "follow" });
      const body = await res.text();
      const all = headerRecord(res.headers);
      const kept: Record<string, string> = {};
      for (const h of KEPT_RESPONSE_HEADERS) if (all[h] !== undefined) kept[h] = all[h];
      return { status: res.status, headers: kept, body };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  function performReplay(method: string, url: string, headers: Record<string, string>) {
    const expected = exchanges[cursor];
    if (!expected) {
      throw new Error(`pack http replay: unexpected extra request #${cursor + 1} for '${source.id}'`);
    }
    if (expected.request.method !== method || expected.request.url !== url) {
      // The URL is already redacted, so this message cannot leak a secret.
      throw new Error(
        `pack http replay: request #${cursor + 1} for '${source.id}' does not match the recording\n` +
          `  expected: ${expected.request.method} ${expected.request.url}\n` +
          `  actual:   ${method} ${url}`,
      );
    }
    for (const [key, value] of Object.entries(expected.request.headers)) {
      if (headers[key] !== value) {
        throw new Error(
          `pack http replay: request #${cursor + 1} for '${source.id}' header '${key}' does not match the recording`,
        );
      }
    }
    cursor++;
    return expected.response;
  }

  const http: PackHttp = {
    async get(rawUrl, init) {
      // Two views of the same request, deliberately kept apart:
      //  - `realHeaders`/`rawUrl` are what actually goes on the wire, secrets
      //    intact, or upstream rejects the credential;
      //  - `url`/`redactedHeaders` are what is recorded, matched during replay
      //    and mentioned in any diagnostic.
      // Conflating them either leaks a secret into a fixture or sends the
      // placeholder to the API.
      const realHeaders = { ...(init?.headers ?? {}), "user-agent": USER_AGENT };
      const url = redactor.text(rawUrl);
      const redactedHeaders = redactor.headers(realHeaders);

      let last: { status: number; headers: Record<string, string>; body: string } | null = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (signal.aborted) {
          note({ sourceId: source.id, attempt, status: null, durationMs: 0, outcome: "aborted" });
          throw new AbortedError();
        }
        const started = now();
        try {
          if (mode === "replay") {
            // Replay still consumes a token per attempt, so the recorded retry
            // count is exercised exactly as it would be live.
            bucket.take();
            last = performReplay("GET", url, redactedHeaders);
          } else {
            // EVERY attempt, including a retry, consumes a rate-limit token.
            await waitForToken();
            last = await performLive(rawUrl, realHeaders);
          }
        } catch (error) {
          const durationMs = now() - started;
          if (error instanceof AbortedError || signal.aborted) {
            note({ sourceId: source.id, attempt, status: null, durationMs, outcome: "aborted" });
            throw new AbortedError();
          }
          note({ sourceId: source.id, attempt, status: null, durationMs, outcome: "error" });
          // Redact before the error escapes: an adapter or the runtime may
          // surface it, and a raw URL could carry a credential.
          if (mode === "replay") throw error;
          throw new Error(`pack http: request failed for '${source.id}'`);
        }

        const durationMs = now() - started;
        const retryable = RETRYABLE(last.status);
        note({
          sourceId: source.id,
          attempt,
          status: last.status,
          durationMs,
          outcome: retryable ? "retryable" : "ok",
        });

        if (mode === "record") {
          recorded.push({
            request: { method: "GET", url, headers: redactedHeaders },
            response: { status: last.status, headers: last.headers, body: redactor.text(last.body) },
          });
        }

        if (!retryable || attempt === MAX_ATTEMPTS) break;

        const advised = parseRetryAfter(last.headers["retry-after"], now());
        const backoff = advised ?? BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
        // Never sleep past the source or invocation deadline: returning the
        // 429 now leaves time for the commit, where sleeping would not.
        if (mode !== "replay" && backoff >= remaining()) break;
        await sleep(backoff);
      }

      return toResponse(last!.status, last!.headers, last!.body);
    },
  };

  return {
    http,
    recorded,
    attempts,
    assertFullyConsumed() {
      if (mode === "replay" && cursor !== exchanges.length) {
        throw new Error(
          `pack http replay: ${exchanges.length - cursor} recorded exchange(s) for '${source.id}' were never requested`,
        );
      }
    },
  };
}
