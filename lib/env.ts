/**
 * Environment, validated once per runtime (docs/milestone-4-plan.md D-06).
 *
 * Three groups, each parsed on first use and memoised, so a missing variable
 * fails at the first call that needs it with the NAMES of what is missing —
 * never a value (SPEC §12), never `undefined` flowing into a client. The
 * `NEXT_PUBLIC_*` variables are read as literal property accesses because
 * Next inlines them by name at build time.
 *
 * `CRON_SECRET` is deliberately NOT validated here: `lib/cron/auth.ts` must
 * fail closed on a weak or absent secret rather than throw.
 */
import { z } from "zod";

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  /** Where password-reset links land: configuration, never the Host header. */
  NEXT_PUBLIC_SITE_URL: z.url(),
});
const ServerEnvSchema = z.object({
  /** Bypasses RLS entirely; built only in app/api/cron/** and lib/jobs/**. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

function parseOrThrow<T extends z.ZodObject>(schema: T, values: Record<string, string | undefined>): z.infer<T> {
  const result = schema.safeParse(values);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))].join(", ");
  throw new Error(`env: missing or invalid ${names}`);
}

let publicCache: PublicEnv | null = null;
let serverCache: ServerEnv | null = null;

export function publicEnv(): PublicEnv {
  publicCache ??= parseOrThrow(PublicEnvSchema, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
  return publicCache;
}

export function serverEnv(): ServerEnv {
  serverCache ??= parseOrThrow(ServerEnvSchema, { SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY });
  return serverCache;
}

/** The site origin without a trailing slash, for reset links and callbacks. */
export function siteUrl(): string {
  return publicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
}

/** Test seam: forget the memoised values so a test can change process.env. */
export function resetEnvCache(): void {
  publicCache = null;
  serverCache = null;
}
