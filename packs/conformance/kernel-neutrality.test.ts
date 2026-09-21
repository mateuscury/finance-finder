/**
 * The enforceable half of "multi-country ready" (MILESTONES.md §4 decision
 * 42; PACKS.md §16): nothing in `app/` or `lib/` source names a pack, a
 * currency or a locale, except `lib/settings/defaults.ts` (the instance
 * defaults) and, for locale literals only, `lib/copy/index.ts` (the
 * languages the instance ships, decision 34). Tests, the database harness
 * and the kernel's own test kit are outside the rule: a test may use a real
 * pack as a fixture.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers";

const SCANNED_DIRS = ["app", "lib"];
const SKIP_DIRS = new Set(["node_modules", ".next", "testing"]);
const SKIP_FILES = new Set(["lib/database.types.ts", "lib/settings/defaults.ts", "lib/calc/valuation/testkit.ts"]);
/** Locale literals are allowed here and nowhere else outside defaults. */
const LOCALE_SITES = new Set(["lib/copy/index.ts"]);

const PACK_ID = /["'`](br|global)(\.[a-z_]+)?["'`]/;
const CURRENCY = /["'`]BRL["'`]/;
const LOCALE = /["'`]pt-BR["'`]/;
/** Supabase's sign-out scope, not the pack id. */
const FALSE_POSITIVE = /scope:\s*["']global["']/;

function walk(dir: string, out: string[]): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|dbtest)\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export function neutralityViolations(root = REPO_ROOT): string[] {
  const hits: string[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of walk(path.join(root, dir), [])) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      if (SKIP_FILES.has(rel)) continue;
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // Comments may cite a pack as an example; code may not.
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (PACK_ID.test(line) && !FALSE_POSITIVE.test(line)) hits.push(`${rel}:${i + 1}: pack id`);
        if (CURRENCY.test(line)) hits.push(`${rel}:${i + 1}: currency code`);
        if (LOCALE.test(line) && !LOCALE_SITES.has(rel)) hits.push(`${rel}:${i + 1}: locale`);
      });
    }
  }
  return hits;
}

describe("kernel neutrality (PACKS.md §16)", () => {
  it("names no pack, currency or locale outside lib/settings/defaults.ts", () => {
    expect(neutralityViolations()).toEqual([]);
  });
});
