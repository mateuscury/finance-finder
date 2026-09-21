/**
 * Global setup for the e2e tier. Runs once before any journey.
 *
 * FAILS, NEVER SKIPS (vitest.db.config.mts states the same rule for the
 * database tier): a missing variable or an unreachable stack is a failure
 * that names what is missing, never a green run that proved nothing.
 *
 * Journeys that need an owner create one through the helpers in
 * `e2e/helpers.ts` (from Milestone 4 Phase 7); this file only proves the
 * environment. `.env.local` is loaded the way the database tier loads it,
 * so the local stack's keys are written once.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertStackReachable, createDbTestClient, requireDbEnv } from "../lib/testing/stack";

function loadDotEnvLocal(): void {
  let text: string;
  try {
    // Playwright loads this file as CommonJS; resolve from the config directory.
    text = readFileSync(path.resolve(__dirname, "../.env.local"), "utf8");
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export default async function globalSetup(): Promise<void> {
  loadDotEnvLocal();
  requireDbEnv();
  if (!process.env.NEXT_PUBLIC_SITE_URL) throw new Error("e2e: NEXT_PUBLIC_SITE_URL must be set (this tier never skips)");
  await assertStackReachable(createDbTestClient());
}
