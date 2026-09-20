/**
 * Shared harness for the real-database test tier (`*.dbtest.ts`, run by
 * `pnpm test:db`; MILESTONES.md §2 decision 8).
 *
 * FAILS, NEVER SKIPS. A missing variable or an unreachable stack is a test
 * failure with a message naming what is missing, so a run without Docker can
 * never report green while proving nothing. `pnpm test` excludes this tier.
 *
 * Every file gets one throwaway auth user created through the admin API and
 * deleted in `afterAll`. All user-scoped tables cascade from `auth.users`, so
 * deleting the user also removes whatever the file wrote there. Tables WITHOUT
 * a user (`series_points`, `ingest_watermarks`, `ingest_cursors`) are the
 * file's own responsibility to clean up.
 *
 * Service-role only, and only here: the key never leaves the test process.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll } from "vitest";

const REQUIRED_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/** Names only, never values (SPEC §12). */
export function requireDbEnv(): { url: string; serviceRoleKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    const missing = REQUIRED_ENV.filter((name) => !process.env[name]).join(", ");
    throw new Error(
      `dbtest: ${missing} must be set. Copy the values printed by \`supabase status\` into .env.local ` +
        "(this tier never skips; start the stack with `pnpm db:start`).",
    );
  }
  return { url, serviceRoleKey };
}

export function createDbTestClient(): SupabaseClient {
  const { url, serviceRoleKey } = requireDbEnv();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * One cheap round trip before any test runs, so a stack that is down or not
 * migrated fails with a single clear message instead of a timeout per test.
 */
export async function assertStackReachable(client: SupabaseClient): Promise<void> {
  let failure: string | null = null;
  try {
    const { error } = await client.from("ingest_cursors").select("source_id", { head: true, count: "exact" });
    if (error) failure = error.message;
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }
  if (failure !== null) {
    throw new Error(
      `dbtest: the local Supabase stack is unreachable or not migrated (${failure}). ` +
        "Run `pnpm db:start` and `pnpm db:reset`.",
    );
  }
}

/** Satisfies supabase/config.toml: 12+ chars, lower, upper, digits, symbols. */
function throwawayPassword(): string {
  return `Aa1!${randomBytes(24).toString("base64url")}`;
}

export interface ThrowawayUser {
  readonly client: SupabaseClient;
  /** Available inside tests and `beforeEach`; throws if read before `beforeAll` ran. */
  readonly userId: string;
}

/**
 * Registers `beforeAll`/`afterAll` for the calling file. Call it once at the
 * top level of a `*.dbtest.ts` file.
 */
export function setupThrowawayUser(): ThrowawayUser {
  const client = createDbTestClient();
  let userId: string | null = null;

  beforeAll(async () => {
    await assertStackReachable(client);
    const { data, error } = await client.auth.admin.createUser({
      // RFC 2606 reserved domain: can never receive mail.
      email: `dbtest-${randomUUID()}@example.com`,
      password: throwawayPassword(),
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`dbtest: could not create the throwaway user (${error?.message ?? "no user returned"})`);
    }
    userId = data.user.id;
  });

  afterAll(async () => {
    if (userId === null) return;
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) throw new Error(`dbtest: could not delete the throwaway user (${error.message})`);
    userId = null;
  });

  return {
    client,
    get userId(): string {
      if (userId === null) throw new Error("dbtest: userId is only available once beforeAll has created the user");
      return userId;
    },
  };
}
