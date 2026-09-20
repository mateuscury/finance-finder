/**
 * Real-database test tier — `pnpm test:db` (MILESTONES.md §2 decision 8).
 *
 * Runs every `*.dbtest.ts` against the LOCAL Supabase stack. The tier never
 * skips: `lib/testing/db.ts` turns a missing variable or an unreachable stack
 * into a failure that names what is missing. `pnpm test` excludes these files.
 */
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Load `.env.local` the way `next dev` would, so the local stack's keys are
// written once and not exported per shell. Existing variables win, as in Next.
// Kept dependency-free: `@next/env` is not hoisted by pnpm.
function loadDotEnvLocal(): void {
  let text: string;
  try {
    text = readFileSync(new URL("./.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnvLocal();

export default defineConfig({
  resolve: { alias: { "@": new URL(".", import.meta.url).pathname } },
  test: {
    include: ["**/*.dbtest.ts"],
    exclude: ["node_modules/**", ".next/**"],
    environment: "node",
    // One shared database: files run one at a time so a file's throwaway rows
    // can never appear in another file's counts.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
