import fs from "node:fs";
import path from "node:path";
import type { MarketPack } from "../types";

export const PACKS_DIR = path.resolve(__dirname, "..");
export const REPO_ROOT = path.resolve(PACKS_DIR, "..");

export function packDir(pack: MarketPack): string {
  return path.join(PACKS_DIR, pack.id);
}

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/** Identifiers from the table in packs/LICENSES.md, e.g. `public-domain`. */
export function licenseAllowlist(): Set<string> {
  const md = fs.readFileSync(path.join(PACKS_DIR, "LICENSES.md"), "utf8");
  const ids = new Set<string>();
  for (const line of md.split("\n")) {
    const m = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/** All .ts source files of a pack, excluding tests. */
export function packSourceFiles(pack: MarketPack): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
    }
  };
  walk(packDir(pack));
  return out;
}

export function importSpecifiers(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const specs: string[] = [];
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+type\s*\(?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) specs.push(m[1] ?? m[2] ?? m[3]);
  // `import("./types").X` type-position imports
  const re2 = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = re2.exec(src))) specs.push(m[1]);
  return specs;
}

// ---------------------------------------------------------------------------
// Adapter test context (plan §1: "hand-rolled context tests like bcb-sgs.test.ts")
//
// Every adapter test builds a FetchContext. Centralising it means the pack API
// contract has exactly one test-side twin: when types.ts changes, this file
// fails to compile and every adapter test is updated together, rather than five
// near-identical fakes drifting apart.
// ---------------------------------------------------------------------------
import type { FetchContext, PackHttpResponse } from "../types";

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): PackHttpResponse {
  const text = JSON.stringify(body);
  return { status, headers, text: async () => text, json: async () => body };
}

/** For sources whose decimal lexemes only survive as raw text (PTAX CSV, Tesouro CSV). */
export function textResponse(status: number, text: string, headers: Record<string, string> = {}): PackHttpResponse {
  return {
    status,
    headers,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  };
}

export interface TestContextOptions {
  /** Handles every ctx.http.get. Throw to simulate a transport failure or abort. */
  get: (url: string, init?: { headers?: Record<string, string> }) => Promise<PackHttpResponse> | PackHttpResponse;
  env?: Record<string, string | undefined>;
  now?: string;
  signal?: AbortSignal;
  /** Static budget, or a function so a test can drain it across calls. */
  remainingMs?: number | (() => number);
}

export function testContext(options: TestContextOptions): FetchContext {
  const { get, env = {}, now = "2026-09-06T12:00:00Z", signal = new AbortController().signal } = options;
  const remaining = options.remainingMs ?? 60_000;
  return {
    http: { get: async (url, init) => get(url, init) },
    env,
    now: () => new Date(now),
    signal,
    remainingMs: () => Math.max(0, typeof remaining === "function" ? remaining() : remaining),
  };
}

/** An already-aborted signal, for budget-exhaustion tests. */
export function abortedSignal(): AbortSignal {
  const c = new AbortController();
  c.abort();
  return c.signal;
}
