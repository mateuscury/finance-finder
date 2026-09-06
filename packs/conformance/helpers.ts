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
