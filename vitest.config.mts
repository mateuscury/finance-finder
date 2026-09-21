import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": new URL(".", import.meta.url).pathname } },
  test: {
    include: ["**/*.test.ts"],
    // `*.dbtest.ts` is the real-database tier (MILESTONES.md §2 decision 8).
    // It runs only under `pnpm test:db` (vitest.db.config.mts) so that a CI
    // run without Docker stays meaningful instead of silently skipping.
    exclude: ["node_modules/**", ".next/**", "**/*.dbtest.ts", "e2e/**"],
    environment: "node",
    // Coverage thresholds (MILESTONES.md §4 decision 50, D-04) are FIXED
    // floors, not a ratchet: `autoUpdate` was tried and raised each floor to
    // a high-water mark that the property tests' random exploration does not
    // reproduce run to run, which is a flake. Raise a floor by hand when a
    // module's tests deliberately add coverage. The kernel is held highest
    // because it is where a financial bug hides.
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: [
        "lib/testing/**",
        "lib/database.types.ts",
        "**/*.test.ts",
        "**/*.dbtest.ts",
        "lib/calc/valuation/testkit.ts",
        // Thin wrappers over next/headers (cookies(), redirect()): exercised
        // by every page render, the build and the e2e journeys, not unit-testable
        // without mocking the framework.
        "lib/auth/session.ts",
        "lib/supabase/server.ts",
        "lib/copy/server.ts",
      ],
      reporter: ["text-summary", "lcov"],
      thresholds: {
        // Branches: 92 is one point under the Phase 1 measurement of 93.6 %
        // (target 95; MILESTONES.md §4 advisories).
        "lib/calc/**": { lines: 97, branches: 92, functions: 97, statements: 96 },
        "lib/{ledger,jobs,import,csv,backup,packs,auth,copy,util,security,settings}/**": {
          lines: 90,
          branches: 85,
          functions: 90,
          statements: 90,
        },
        "lib/env.ts": { lines: 95, branches: 90, functions: 95, statements: 95 },
      },
    },
  },
});
