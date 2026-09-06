/**
 * PACKS.md §11.3 Fixture coverage, §11.4 Output contract, §11.5 Golden portfolio.
 *
 * These are the real gates. They depend on kernel pieces that do not exist yet
 * (lib/packs/http.ts fixture replay; lib/calc valuation). Each test is skipped
 * with an explicit reason until its prerequisite lands, so the skip count in
 * CI is itself the to-do list.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKS } from "..";
import { packDir, readJson } from "./helpers";

const REQUIRED_FIXTURES = ["success", "empty", "upstream_5xx", "rate_limited_429"] as const;

describe.each(PACKS.map((p) => [p.id, p] as const))("pack '%s' — fixtures", (_, pack) => {
  const httpFixtures = path.join(packDir(pack), "fixtures", "http");
  const hasReplay = fs.existsSync(path.resolve(__dirname, "../../lib/packs/http.ts"));

  describe.each(pack.sources.map((s) => [s.id, s] as const))("source %s", (_, source) => {
    it.skipIf(!hasReplay)(
      "has recorded fixtures for success, empty, 5xx and 429 (needs lib/packs/http.ts)",
      () => {
        for (const name of REQUIRED_FIXTURES) {
          const f = path.join(httpFixtures, source.id, `${name}.json`);
          expect(fs.existsSync(f), `missing ${path.relative(packDir(pack), f)}`).toBe(true);
        }
      },
    );

    it.skipIf(!hasReplay)("output contract holds over replayed fixtures (needs lib/packs/http.ts)", () => {
      // Implemented alongside lib/packs/http.ts: replay each fixture through
      // source.fetch and assert FetchPointSchema + not-in-future + ISO currency.
      expect.fail("not implemented");
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
      expect.fail("not implemented: wire to lib/calc once Milestones 1–3 land");
    },
  );
});
