/**
 * Fixture recorder (plan §2.3).
 *
 *   pnpm fixtures:record --source br.bcb_sgs
 *   pnpm fixtures:record --source br.brapi --fixture success
 *   pnpm fixtures:record --all
 *
 * Rules this script enforces, not merely documents:
 *  - selection is EXPLICIT. Running it with no arguments records nothing, so a
 *    stray invocation cannot silently rewrite every fixture in the repository.
 *  - live networking happens only for `success` and `empty`, and only in
 *    `record` mode.
 *  - `upstream_5xx` and `rate_limited_429` are SYNTHESIZED locally. Waiting for
 *    a real upstream to fail is neither reproducible nor polite.
 *  - redaction runs inside lib/packs/http.ts, before a byte reaches the fixture
 *    object; this script additionally refuses to WRITE anything that still
 *    looks like a credential.
 */
import fs from "node:fs";
import path from "node:path";
import { PACKS } from "../packs";
import type { FetchContext, FetchRequest, PriceSource } from "../packs/types";
import { createPackHttp, MAX_ATTEMPTS } from "../lib/packs/http";
import { FIXTURE_VERSION, findSecretLeaks, type FixtureCase, type FixtureFile } from "../lib/packs/fixtures";
import { catalogFor, FIXTURE_CATALOG, type SourceCatalog } from "./fixture-catalog";

const ROOT = path.resolve(__dirname, "..");
const RECORD_TIMEOUT_MS = 120_000;

function usage(message: string): never {
  console.error(`${message}\n`);
  console.error("usage: tsx scripts/record-fixtures.ts (--source <id> | --all) [--fixture <name>]");
  console.error("  names: success | empty | upstream_5xx | rate_limited_429");
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const sources: string[] = [];
  const fixtures: string[] = [];
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--all") all = true;
    else if (argv[i] === "--source") sources.push(argv[++i] ?? usage("--source needs a value"));
    else if (argv[i] === "--fixture") fixtures.push(argv[++i] ?? usage("--fixture needs a value"));
    else usage(`unknown argument '${argv[i]}'`);
  }
  if (!all && sources.length === 0) usage("refusing to record implicitly: pass --source <id> or --all");
  return { sources, fixtures, all };
}

function locate(sourceId: string): { pack: string; source: PriceSource } {
  for (const pack of PACKS) {
    const source = pack.sources.find((s) => s.id === sourceId);
    if (source) return { pack: pack.id, source };
  }
  usage(`no registered source '${sourceId}'`);
}

function fixturePath(packId: string, sourceId: string, name: string): string {
  return path.join(ROOT, "packs", packId, "fixtures", "http", sourceId, `${name}.json`);
}

/** Only the source's declared variables are visible to it (PACKS.md §7). */
function scopedEnv(source: PriceSource): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const name of source.envVars ?? []) env[name] = process.env[name];
  return env;
}

async function recordLiveCase(
  source: PriceSource,
  input: FetchRequest,
  catalog: SourceCatalog,
  recordedAt: Date,
): Promise<FixtureCase> {
  const controller = new AbortController();
  const deadline = Date.now() + RECORD_TIMEOUT_MS;
  const handle = createPackHttp({
    source,
    mode: "record",
    signal: controller.signal,
    deadline,
    env: scopedEnv(source),
  });
  const ctx: FetchContext = {
    http: handle.http,
    env: scopedEnv(source),
    now: () => recordedAt,
    signal: controller.signal,
    remainingMs: () => Math.max(0, deadline - Date.now()),
  };
  const result = await source.fetch(input, ctx);
  const exchanges = handle.recorded.map((exchange) =>
    catalog.trimBody
      ? { ...exchange, response: { ...exchange.response, body: catalog.trimBody!(exchange.response.body) } }
      : exchange,
  );
  console.log(
    `    ${input.capability} refs=${input.refs.length} -> ${result.points.length} point(s), ` +
      `${exchanges.length} exchange(s), ${result.warnings.length} warning(s)`,
  );
  return { input, exchanges };
}

/**
 * Build a retryable-failure transcript locally by running the REAL adapter
 * against a stub transport that always returns the failure. No network is
 * touched and nothing sleeps, yet the transcript contains genuine URLs and
 * headers — so strict replay still matches, and the full three-attempt retry
 * policy is exercised exactly as it would be live.
 */
async function synthesizeFailure(
  source: PriceSource,
  input: FetchRequest,
  status: number,
  recordedAt: Date,
): Promise<FixtureCase> {
  const headers: Record<string, string> = status === 429 ? { "retry-after": "1" } : {};
  const body =
    status === 429
      ? '{"error":"rate limited","synthetic":true}'
      : '{"error":"upstream unavailable","synthetic":true}';
  const controller = new AbortController();
  let clock = recordedAt.getTime();
  const deadline = clock + RECORD_TIMEOUT_MS;
  const handle = createPackHttp({
    source,
    mode: "record",
    signal: controller.signal,
    deadline,
    env: scopedEnv(source),
    now: () => clock,
    // Backoff is simulated, never waited on.
    sleep: async (ms: number) => {
      clock += ms;
    },
    fetchImpl: (async () => new Response(body, { status, headers })) as unknown as typeof fetch,
  });
  const ctx: FetchContext = {
    http: handle.http,
    env: scopedEnv(source),
    now: () => recordedAt,
    signal: controller.signal,
    remainingMs: () => Math.max(0, deadline - clock),
  };
  const result = await source.fetch(input, ctx);
  console.log(
    `    ${status}: ${handle.recorded.length} exchange(s) over ${MAX_ATTEMPTS} attempt(s), ` +
      `${result.points.length} point(s), ${result.warnings.length} warning(s)`,
  );
  return { input, exchanges: handle.recorded };
}

async function main() {
  const { sources, fixtures, all } = parseArgs(process.argv.slice(2));
  const wanted = all ? FIXTURE_CATALOG.map((c) => c.sourceId) : sources;
  const names = fixtures.length > 0 ? fixtures : ["success", "empty", "upstream_5xx", "rate_limited_429"];
  const recordedAt = new Date();

  for (const sourceId of wanted) {
    const catalog = catalogFor(sourceId) ?? usage(`no fixture catalog entry for '${sourceId}'`);
    const { pack, source } = locate(sourceId);
    console.log(`\n${sourceId} (packs/${pack})`);

    for (const name of names) {
      let cases: FixtureCase[];
      if (name === "success" || name === "empty") {
        const wantedCases = name === "success" ? catalog.success : catalog.empty;
        console.log(`  ${name}: recording ${wantedCases.length} case(s) live`);
        cases = [];
        for (const c of wantedCases) {
          console.log(`    - ${c.note}`);
          cases.push(await recordLiveCase(source, c.input, catalog, recordedAt));
        }
      } else if (name === "upstream_5xx" || name === "rate_limited_429") {
        console.log(`  ${name}: synthesizing locally (no upstream failure is waited for)`);
        cases = [await synthesizeFailure(source, catalog.errorInput, name === "upstream_5xx" ? 503 : 429, recordedAt)];
      } else {
        usage(`unknown fixture name '${name}'`);
      }

      const file: FixtureFile = { version: FIXTURE_VERSION, recordedAt: recordedAt.toISOString(), cases };
      const serialized = `${JSON.stringify(file, null, 2)}\n`;
      const leaks = findSecretLeaks(serialized);
      if (leaks.length > 0) {
        console.error(`  REFUSING TO WRITE ${sourceId}/${name}.json: found ${leaks.join(", ")}`);
        process.exit(1);
      }
      const target = fixturePath(pack, sourceId, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, serialized);
      console.log(`  wrote ${path.relative(ROOT, target)} (${(serialized.length / 1024).toFixed(1)} KiB)`);
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
