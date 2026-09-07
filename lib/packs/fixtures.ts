/**
 * Recorded HTTP fixture envelope (plan §2.2).
 *
 * ONE versioned object, deliberately not a bare array: an array has nowhere to
 * carry `recordedAt`, and `recordedAt` is what supplies `ctx.now()` during
 * replay. Without a pinned clock, an adapter that defaults `to` to "today"
 * would ask for a different window every day and replay would rot.
 */
import { z } from "zod";

export const FIXTURE_VERSION = 1;

/** Fixture kinds every source must ship (PACKS.md §11.3). */
export const REQUIRED_FIXTURES = ["success", "empty", "upstream_5xx", "rate_limited_429"] as const;
export type FixtureName = (typeof REQUIRED_FIXTURES)[number];

export const ExchangeSchema = z.object({
  request: z.object({
    method: z.literal("GET"),
    url: z.string().min(1),
    /** Only what replay matches on; never the full outgoing header set. */
    headers: z.record(z.string(), z.string()),
  }),
  response: z.object({
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string(), z.string()),
    body: z.string(),
  }),
});
export type Exchange = z.infer<typeof ExchangeSchema>;

export const FixtureCaseSchema = z.object({
  input: z.object({
    capability: z.enum(["spot", "historical", "series", "fx"]),
    refs: z.array(z.string().min(1)).min(1),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  }),
  exchanges: z.array(ExchangeSchema),
});
export type FixtureCase = z.infer<typeof FixtureCaseSchema>;

export const FixtureFileSchema = z.object({
  version: z.literal(FIXTURE_VERSION),
  recordedAt: z.iso.datetime(),
  cases: z.array(FixtureCaseSchema).min(1),
});
export type FixtureFile = z.infer<typeof FixtureFileSchema>;

/** Any leftover credential shape that must never appear in a checked-in fixture. */
const SECRET_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /Bearer\s+(?!<REDACTED:)\S+/i, why: "an unredacted Authorization value" },
  { pattern: /[?&](token|apikey|api_key|access_token|key)=(?!<REDACTED:)[^&\s"]+/i, why: "a secret in a query string" },
];

/**
 * Scan a fixture's serialized form for anything that looks like a live
 * credential. This is the last line of defence behind `createRedactor`: the
 * redactor can only remove values it was told about, so this catches a secret
 * that arrived by a route nobody declared.
 */
export function findSecretLeaks(serialized: string): string[] {
  return SECRET_PATTERNS.filter((p) => p.pattern.test(serialized)).map((p) => p.why);
}
