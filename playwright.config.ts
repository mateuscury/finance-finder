/**
 * The browser end-to-end tier — `pnpm test:e2e` (MILESTONES.md §4 decision
 * 46). Like `pnpm test:db`, it FAILS, NEVER SKIPS: no browser, no stack or
 * no environment is a failure that names what is missing (`e2e/setup.ts`).
 * `pnpm test` excludes it; `pnpm release:check` requires it.
 *
 * One shared local database: files run one at a time so one journey's
 * throwaway rows never appear in another's counts.
 */
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // A browsable report in CI, where the artifact is all a reader gets; the
  // terminal list locally.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  globalSetup: "./e2e/setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    {
      name: "phone",
      use: { ...devices["Desktop Chrome"], viewport: { width: 400, height: 800 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    // Production build in CI so a journey exercises what deploys; the dev
    // server locally so a change is seen without a rebuild.
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    // No journey may reach a live source (P7-U1). `Refresh` runs ingestion
    // from a server action, and `.env.local` carries a real BRAPI_TOKEN, so
    // the server under test is started without it: `lib/packs/ingest.ts`
    // preflights on `!env[name]`, so an empty value is a missing one and the
    // run is offline, deterministic, and identical in CI.
    env: { ...(process.env as Record<string, string>), BRAPI_TOKEN: "" },
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
