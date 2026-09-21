/**
 * PACKS.md §11.6 Licence check, §11.7 Dependency check, §11.8 Docs.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKS } from "..";
import { importSpecifiers, licenseAllowlist, packDir, packSourceFiles } from "./helpers";

const ALLOWED_BARE_IMPORTS = new Set(["zod"]);

describe.each(PACKS.map((p) => [p.id, p] as const))("pack '%s' — hygiene", (_, pack) => {
  it("every source licence is on the allowlist in packs/LICENSES.md", () => {
    const allow = licenseAllowlist();
    for (const s of pack.sources) {
      expect(allow, `${s.id} licence '${s.license}' is not in packs/LICENSES.md`).toContain(s.license);
    }
  });

  it("introduces no npm dependency and imports nothing from lib/", () => {
    for (const file of packSourceFiles(pack)) {
      for (const spec of importSpecifiers(file)) {
        const rel = path.relative(packDir(pack), file);
        if (spec.startsWith(".")) {
          const target = path.resolve(path.dirname(file), spec);
          expect(target.includes(`${path.sep}lib${path.sep}`), `${rel} imports '${spec}' (lib/ is kernel-only)`).toBe(
            false,
          );
          continue;
        }
        if (spec.startsWith("@/")) {
          expect(spec.startsWith("@/packs/"), `${rel} imports '${spec}' — only packs/ is allowed`).toBe(true);
          expect(spec.startsWith("@/lib/"), `${rel} imports '${spec}' (lib/ is kernel-only)`).toBe(false);
          continue;
        }
        expect(ALLOWED_BARE_IMPORTS, `${rel} imports '${spec}' — packs add no npm dependencies`).toContain(spec);
      }
    }
  });

  it("uses ctx.http, never global fetch or axios", () => {
    for (const file of packSourceFiles(pack)) {
      const rel = path.relative(packDir(pack), file);
      const src = fs
        .readFileSync(file, "utf8")
        // strip PriceSource.fetch *definitions* (`async fetch(req, ctx) {`) and
        // property-style calls (`source.fetch(...)`); only bare `fetch(` remains.
        .replace(/^\s*(?:async\s+)?fetch\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/gm, "")
        .replace(/\.fetch\s*\(/g, ".__method(");
      expect(/(^|[^.\w])fetch\s*\(/m.test(src), `${rel} calls global fetch()`).toBe(false);
      expect(/from\s*['"](axios|node-fetch|undici|got)['"]/.test(src), `${rel} imports an HTTP client`).toBe(false);
    }
  });

  it("ships README.md with coverage, sources and quirks sections", () => {
    const readme = path.join(packDir(pack), "README.md");
    expect(fs.existsSync(readme), `${pack.id}/README.md missing`).toBe(true);
    const md = fs.readFileSync(readme, "utf8");
    for (const h of ["## Coverage", "## Sources", "## Quirks"]) {
      expect(md, `${pack.id}/README.md lacks '${h}'`).toContain(h);
    }
  });
});
