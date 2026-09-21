/**
 * Shared harness for the real-database test tier (`*.dbtest.ts`, run by
 * `pnpm test:db`; MILESTONES.md §2 decision 8). The vitest-free parts live
 * in `stack.ts` so the e2e tier can load them; this file adds the
 * `beforeAll`/`afterAll` wiring and re-exports the rest.
 */
import type { Db } from "@/lib/supabase/types";
import { afterAll, beforeAll } from "vitest";
import { assertStackReachable, createDbTestClient, createThrowawayUser, type ThrowawayUserHandle } from "./stack";

export {
  assertStackReachable,
  createDbTestClient,
  createThrowawayUser,
  requireDbEnv,
  type ThrowawayUserHandle,
} from "./stack";

export interface ThrowawayUser {
  readonly client: Db;
  /** Available inside tests and `beforeEach`; throws if read before `beforeAll` ran. */
  readonly userId: string;
  /** See `ThrowawayUserHandle.signIn`. */
  signIn(): Promise<Db>;
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
