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
  },
});
