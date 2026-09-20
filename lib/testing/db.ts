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

const REQUIRED_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

/** Names only, never values (SPEC §12). */
export function requireDbEnv(): { url: string; serviceRoleKey: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !serviceRoleKey || !anonKey) {
    const missing = REQUIRED_ENV.filter((name) => !process.env[name]).join(", ");
    throw new Error(
      `dbtest: ${missing} must be set. Copy the values printed by \`supabase status\` into .env.local ` +
        "(this tier never skips; start the stack with `pnpm db:start`).",
    );
  }
  return { url, serviceRoleKey, anonKey };
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

export interface ThrowawayUserHandle {
  readonly userId: string;
  /**
   * A client on the ANON key signed in as this user — the only way to exercise
   * an RPC that reads `auth.uid()` or relies on RLS, both of which the service
   * role bypasses (docs/milestone-2-plan.md Phase 6 grounding).
   */
  signIn(): Promise<SupabaseClient>;
  /** Deletes the auth user; every user-scoped table cascades. Idempotent. */
  remove(): Promise<void>;
}

/** One throwaway auth user through the admin API. Callers own its lifetime. */
export async function createThrowawayUser(admin: SupabaseClient): Promise<ThrowawayUserHandle> {
  const { url, anonKey } = requireDbEnv();
  // RFC 2606 reserved domain: can never receive mail.
  const email = `dbtest-${randomUUID()}@example.com`;
  const password = throwawayPassword();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    throw new Error(`dbtest: could not create the throwaway user (${error?.message ?? "no user returned"})`);
  }
  let alive = true;
  const userId = data.user.id;
  return {
    userId,
    async signIn() {
      const client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const signedIn = await client.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw new Error(`dbtest: could not sign the throwaway user in (${signedIn.error.message})`);
      return client;
    },
    async remove() {
      if (!alive) return;
      const removed = await admin.auth.admin.deleteUser(userId);
      if (removed.error) throw new Error(`dbtest: could not delete the throwaway user (${removed.error.message})`);
      alive = false;
    },
  };
}

export interface ThrowawayUser {
  readonly client: SupabaseClient;
  /** Available inside tests and `beforeEach`; throws if read before `beforeAll` ran. */
  readonly userId: string;
  /** See `ThrowawayUserHandle.signIn`. */
  signIn(): Promise<SupabaseClient>;
}

/**
 * Registers `beforeAll`/`afterAll` for the calling file. Call it once at the
 * top level of a `*.dbtest.ts` file.
 */
export function setupThrowawayUser(): ThrowawayUser {
  const client = createDbTestClient();
  let handle: ThrowawayUserHandle | null = null;

  beforeAll(async () => {
    await assertStackReachable(client);
    handle = await createThrowawayUser(client);
  });

  afterAll(async () => {
    await handle?.remove();
    handle = null;
  });

  const current = (): ThrowawayUserHandle => {
    if (handle === null) throw new Error("dbtest: the throwaway user is only available once beforeAll has created it");
    return handle;
  };
  return {
    client,
    get userId(): string {
      return current().userId;
    },
    signIn: () => current().signIn(),
  };
}
