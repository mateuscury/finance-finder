/**
 * PACKS.md §11.3 Fixture coverage, §11.4 Output contract, §11.5 Golden portfolio.
 *
 * These are the real gates. Every source is replayed from its recorded
 * fixtures with NO network access, and its output is checked against the
 * kernel contract and the manifest that asked for it.
 *
 * The only remaining skips are the two Milestone 2 kernel-reproduction cases
 * and the golden-portfolio case for a pack with no instruments. A pack marked
 * `supported` is never allowed to use them: missing evidence fails.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKS } from "..";
import { RefCoverageSchema } from "../schema";
import type { FetchContext, FetchPoint, InstrumentKind, MarketPack, PriceSource, SeriesDescriptor } from "../types";
import { createPackHttp, MAX_ATTEMPTS } from "@/lib/packs/http";
import { FixtureFileSchema, findSecretLeaks, REQUIRED_FIXTURES, type FixtureCase } from "@/lib/packs/fixtures";
import { validatePoints } from "@/lib/packs/validate";
import { packDir, readJson } from "./helpers";

/**
 * Replay must never reach the network. Any value here would be a bug, so the
 * transport handed to the runtime throws unconditionally.
 */
const NO_NETWORK = (() => {
  throw new Error("conformance replay attempted a real network request");
}) as unknown as typeof fetch;

/** A deterministic stand-in for each declared secret, so redaction matches. */
function replayEnv(source: PriceSource): Record<string, string> {
  return Object.fromEntries((source.envVars ?? []).map((name) => [name, `fixture-${name.toLowerCase()}-value`]));
}

/** Series visible to a pack: its own plus those of its declared dependencies. */
function seriesInScope(pack: MarketPack): Map<string, SeriesDescriptor> {
  const out = new Map<string, SeriesDescriptor>();
  const visit = (p: MarketPack) => {
    for (const s of p.series) out.set(s.id, s);
    for (const depId of p.dependencies ?? []) {
      const dep = PACKS.find((c) => c.id === depId);
      if (dep) visit(dep);
    }
  };
  visit(pack);
  return out;
}

/**
 * Map an asset ref onto the instrument kind it must be priced as. Fixture refs
 * that are not series ids are asset identifiers, and the instrument that owns
 * them is the one whose valuation names this source.
 */
function instrumentsForSource(pack: MarketPack, source: PriceSource, refs: string[], series: Map<string, SeriesDescriptor>) {
  const kind = pack.instruments.find(
    (i) => (i.valuation.kind === "market_price" || i.valuation.kind === "nav_unit_price") && i.valuation.sourceId === source.id,
  );
  const out = new Map<string, InstrumentKind>();
  if (!kind) return out;
  for (const ref of refs) if (!series.has(ref)) out.set(ref, kind);
  return out;
}

interface ReplayOutcome {
  points: FetchPoint[];
  warnings: string[];
  coverage: ReturnType<typeof RefCoverageSchema.safeParse> extends never ? never : NonNullable<Awaited<ReturnType<PriceSource["fetch"]>>["coverage"]> | undefined;
  attempts: number;
  elapsedMs: number;
}

async function replayCase(source: PriceSource, fixtureCase: FixtureCase, recordedAt: string): Promise<ReplayOutcome> {
  const handle = createPackHttp({
    source,
    mode: "replay",
    signal: new AbortController().signal,
    deadline: Number.MAX_SAFE_INTEGER,
    env: replayEnv(source),
    exchanges: fixtureCase.exchanges,
    now: () => 0,
    fetchImpl: NO_NETWORK,
  });
  const ctx: FetchContext = {
    http: handle.http,
    env: replayEnv(source),
    // The recording's clock, so an adapter that defaults a window to "today"
    // replays identically forever.
    now: () => new Date(recordedAt),
    signal: new AbortController().signal,
    remainingMs: () => 60_000,
  };
  const started = Date.now();
  const result = await source.fetch(fixtureCase.input, ctx);
  const elapsedMs = Date.now() - started;
  handle.assertFullyConsumed();
  return { ...result, coverage: result.coverage, attempts: handle.attempts.length, elapsedMs };
}

describe.each(PACKS.map((p) => [p.id, p] as const))("pack '%s' — fixtures", (_, pack) => {
  const httpFixtures = path.join(packDir(pack), "fixtures", "http");
  const series = seriesInScope(pack);

  it("does not claim support before replay and golden prerequisites exist", () => {
    if (pack.status !== "supported") return;
    expect(fs.existsSync(path.resolve(__dirname, "../../lib/packs/http.ts"))).toBe(true);
    if (pack.instruments.length > 0) {
      const expectedFile = path.join(packDir(pack), "fixtures", "expected.json");
      const expected = fs.existsSync(expectedFile) ? readJson<Record<string, unknown>>(expectedFile) : null;
      for (const key of ["valuation", "twr", "mwr"]) {
        expect(expected?.[key], `supported packs require golden ${key} output`).toBeDefined();
        expect(expected?.[key], `supported packs require golden ${key} output`).not.toBeNull();
      }
    }
  });

  describe.each(pack.sources.map((s) => [s.id, s] as const))("source %s", (_, source) => {
    const fileFor = (name: string) => path.join(httpFixtures, source.id, `${name}.json`);
    const load = (name: string) => {
      const parsed = FixtureFileSchema.safeParse(readJson(fileFor(name)));
      expect(parsed.success, parsed.success ? "" : `${source.id}/${name}.json: ${JSON.stringify(parsed.error.issues)}`).toBe(true);
      return parsed.success ? parsed.data : null;
    };

    it("has recorded fixtures for success, empty, 5xx and 429", () => {
      for (const name of REQUIRED_FIXTURES) {
        expect(fs.existsSync(fileFor(name)), `missing ${path.relative(packDir(pack), fileFor(name))}`).toBe(true);
      }
    });

    it("ships fixtures in the supported envelope version", () => {
      for (const name of REQUIRED_FIXTURES) expect(load(name)).not.toBeNull();
    });

    it("leaks no credential, token query or user-derived identifier", () => {
      for (const name of REQUIRED_FIXTURES) {
        const raw = fs.readFileSync(fileFor(name), "utf8");
        expect(findSecretLeaks(raw), `${source.id}/${name}.json`).toEqual([]);
        // Any real value of a declared variable must have been replaced.
        for (const varName of source.envVars ?? []) {
          const live = process.env[varName];
          if (live && live.length >= 6) expect(raw).not.toContain(live);
        }
        // Fixture INPUTS come from the checked-in catalog, never a user's
        // database, so no ref may look like a database id. (The check is scoped
        // to inputs on purpose: a public dataset URL may legitimately contain a
        // UUID — Tesouro's CKAN resource path does.)
        const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        for (const fixtureCase of load(name)!.cases) {
          for (const ref of fixtureCase.input.refs) {
            expect(uuid.test(ref), `${source.id}/${name}.json ref '${ref}' looks user-derived`).toBe(false);
          }
        }
      }
    });

    it("covers every declared capability in both success and empty cases", () => {
      for (const name of ["success", "empty"] as const) {
        const file = load(name)!;
        const covered = new Set(file.cases.map((c) => c.input.capability));
        for (const capability of source.capabilities) {
          expect(covered, `${source.id}/${name}.json does not exercise '${capability}'`).toContain(capability);
        }
      }
    });

    it("output contract holds over replayed fixtures", async () => {
      for (const name of ["success", "empty"] as const) {
        const file = load(name)!;
        const recordedDate = file.recordedAt.slice(0, 10);

        for (const fixtureCase of file.cases) {
          const { input } = fixtureCase;
          const where = `${source.id}/${name}.json [${input.capability}]`;
          const outcome = await replayCase(source, fixtureCase, file.recordedAt);

          // --- structural + semantic validation against the manifest ---------
          const scope = {
            series,
            instruments: instrumentsForSource(pack, source, input.refs, series),
            requested: new Set(input.refs),
            from: input.from,
            to: input.to,
            now: recordedDate,
          };
          const validation = validatePoints(outcome.points, scope);
          expect(
            validation.rejected,
            `${where} emitted invalid point(s): ${JSON.stringify(validation.rejected)}`,
          ).toEqual([]);

          // --- primary keys unique within one result -------------------------
          const keys = outcome.points.map((p) => `${p.ref}|${p.date}|${p.tenorDays ?? 0}`);
          expect(new Set(keys).size, `${where} repeated a primary key`).toBe(keys.length);

          // --- nothing dated after the recording ------------------------------
          for (const p of outcome.points) {
            expect(p.date <= recordedDate, `${where} dated ${p.date} after recordedAt`).toBe(true);
          }

          // --- structured coverage --------------------------------------------
          const bounded = input.from !== undefined && input.to !== undefined;
          if (!bounded) {
            expect(outcome.coverage, `${where} is unbounded and must declare no coverage`).toBeUndefined();
          } else {
            expect(outcome.coverage, `${where} is bounded and must declare coverage`).toBeDefined();
            const coverage = outcome.coverage!;
            expect(coverage.map((c) => c.ref), `${where} coverage must name every requested ref`).toEqual(input.refs);

            for (const entry of coverage) {
              expect(RefCoverageSchema.safeParse(entry).success, `${where} coverage for '${entry.ref}' is malformed`).toBe(true);
              expect(entry.requested).toEqual({ from: input.from, to: input.to });

              const forRef = outcome.points.filter((p) => p.ref === entry.ref).map((p) => p.date).sort();
              if (forRef.length === 0) {
                expect(entry.returned, `${where} claims a span for '${entry.ref}' with no points`).toBeNull();
              } else {
                expect(entry.returned, `${where} returned points for '${entry.ref}' but no span`).toEqual({
                  from: forRef[0],
                  to: forRef[forRef.length - 1],
                });
              }
              // Only an explicitly complete result may certify an empty window.
              if (entry.returned === null && entry.complete) {
                expect(outcome.warnings.join(" ")).not.toMatch(/failed|unavailable|budget/i);
              }
            }
          }
        }
      }
    });

    it.each(["upstream_5xx", "rate_limited_429"] as const)(
      "%s emits no points, warns safely, and exhausts exactly the attempt budget without sleeping",
      async (name) => {
        const file = load(name)!;
        for (const fixtureCase of file.cases) {
          const outcome = await replayCase(source, fixtureCase, file.recordedAt);
          expect(outcome.points, `${source.id}/${name} emitted points`).toEqual([]);
          expect(outcome.warnings.length, `${source.id}/${name} produced no warning`).toBeGreaterThan(0);
          // Exactly the configured attempts: one initial try plus two retries.
          expect(outcome.attempts, `${source.id}/${name} attempt count`).toBe(MAX_ATTEMPTS);
          // Replay injects a no-op sleep, so a real backoff would show up here.
          expect(outcome.elapsedMs, `${source.id}/${name} slept for real`).toBeLessThan(1_000);
          // A warning may name the source and status, never a URL or a secret.
          for (const warning of outcome.warnings) {
            expect(warning).not.toMatch(/https?:\/\//);
            expect(findSecretLeaks(warning)).toEqual([]);
          }
          // A bounded failure must never certify coverage.
          for (const entry of outcome.coverage ?? []) {
            expect(entry.complete, `${source.id}/${name} certified '${entry.ref}' behind a failure`).toBe(false);
          }
        }
      },
    );

    it("replay rejects a changed URL, a changed order and an unused exchange", async () => {
      const file = load("success")!;
      const multi = file.cases.find((c) => c.exchanges.length > 1);
      const single = file.cases.find((c) => c.exchanges.length > 0)!;

      // Tampering must always be rejected, but it can surface two ways: the
      // mismatch throws inside ctx.http.get, and a well-behaved adapter CATCHES
      // that (it must not crash on a transport error) and returns a warning
      // instead. The unconsumed exchange is then what fails the replay. Either
      // message is a hard rejection; a silent pass is not possible.
      const REJECTED = /does not match the recording|never requested|unexpected extra request/;

      // Changed URL.
      const mutated: FixtureCase = {
        ...single,
        exchanges: single.exchanges.map((e, i) =>
          i === 0 ? { ...e, request: { ...e.request, url: `${e.request.url}#tampered` } } : e,
        ),
      };
      await expect(replayCase(source, mutated, file.recordedAt)).rejects.toThrow(REJECTED);

      // Changed order (only meaningful with more than one exchange).
      if (multi) {
        const reordered: FixtureCase = { ...multi, exchanges: [...multi.exchanges].reverse() };
        await expect(replayCase(source, reordered, file.recordedAt)).rejects.toThrow(REJECTED);
      }

      // Unused exchange.
      const extra: FixtureCase = { ...single, exchanges: [...single.exchanges, single.exchanges[0]] };
      await expect(replayCase(source, extra, file.recordedAt)).rejects.toThrow(REJECTED);
    });
  });

  it.skipIf(pack.instruments.length === 0)("ships golden portfolio fixtures (portfolio.json + expected.json)", () => {
    for (const f of ["portfolio.json", "expected.json"]) {
      expect(fs.existsSync(path.join(packDir(pack), "fixtures", f)), `${pack.id}/fixtures/${f} missing`).toBe(true);
    }
  });

  const expectedFile = path.join(packDir(pack), "fixtures", "expected.json");
  const expected = fs.existsSync(expectedFile) ? readJson<{ valuation: unknown }>(expectedFile) : null;
  const goldenReady = expected !== null && expected.valuation !== null;

  it.skipIf(!goldenReady)(
    "kernel reproduces hand-computed valuation, TWR and MWR to 1e-8 (needs lib/calc + expected.json)",
    () => {
      expect.fail("not implemented: wire to lib/calc once Milestone 2 lands");
    },
  );
});
