/**
 * Settings writes (SPEC §9 screen 9; decisions 26, 28).
 *
 * Base currency locks at the first transaction; the reset is one explicit
 * action, after which the decision 20 trigger drops every snapshot and the
 * next run rebuilds history in the new base. Packs are chosen from the
 * registry: draft is allowed (the owner's informed consent, PACKS §12),
 * unmaintained and unknown are refused.
 */
import type { Db } from "@/lib/supabase/types";
import type { MarketPack } from "@/packs/types";
import { z } from "zod";
import { isSupportedLocale } from "@/lib/copy";
import { fail, ok, reasonFor, type ActionResult } from "./result";
import { BaseCurrencyInputSchema, failedFields } from "./schemas";

export async function changeBaseCurrency(
  client: Db,
  userId: string,
  input: unknown,
): Promise<ActionResult<{ reset: boolean }>> {
  const parsed = BaseCurrencyInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", failedFields(parsed.error));
  const current = await client.from("user_settings").select("base_currency").eq("user_id", userId).maybeSingle();
  if (current.error) return fail(reasonFor(current.error));
  if (current.data?.base_currency === parsed.data.base_currency) return ok({ reset: false });
  const { count, error } = await client.from("transactions").select("*", { count: "exact", head: true });
  if (error) return fail(reasonFor(error));
  const locked = (count ?? 0) > 0;
  if (locked && !parsed.data.confirmReset) return fail("base_locked", ["base_currency"]);
  const write = await client
    .from("user_settings")
    .upsert({ user_id: userId, base_currency: parsed.data.base_currency }, { onConflict: "user_id" });
  return write.error ? fail(reasonFor(write.error)) : ok({ reset: locked });
}

// A locale is one the instance ships copy for (decision 34): the select on
// Settings lists exactly these, and a hand-made request cannot name another.
const PreferencesSchema = z.object({
  theme: z.enum(["system", "light", "dark"]),
  locale: z.string().trim().refine(isSupportedLocale, "a shipped locale"),
});

export async function updatePreferences(client: Db, userId: string, input: unknown): Promise<ActionResult> {
  const parsed = PreferencesSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", failedFields(parsed.error));
  const { error } = await client
    .from("user_settings")
    .upsert({ user_id: userId, ...parsed.data }, { onConflict: "user_id" });
  return error ? fail(reasonFor(error)) : ok(undefined);
}

/**
 * Enables exactly `packIds` (decision 28). Returns the ids that were not
 * enabled before, so the caller can backfill their series after the response.
 */
export async function setEnabledPacks(
  client: Db,
  userId: string,
  registry: readonly MarketPack[],
  packIds: readonly string[],
): Promise<ActionResult<{ newlyEnabled: string[] }>> {
  const wanted = [...new Set(packIds)];
  for (const id of wanted) {
    const pack = registry.find((p) => p.id === id);
    if (!pack) return fail("unknown_kind", ["enabled_packs"]);
    if (pack.status === "unmaintained") return fail("invalid_input", ["enabled_packs"]);
  }
  const current = await client.from("user_settings").select("enabled_packs").eq("user_id", userId).maybeSingle();
  if (current.error) return fail(reasonFor(current.error));
  const before = new Set((current.data?.enabled_packs as string[] | null) ?? []);
  const { error } = await client
    .from("user_settings")
    .upsert({ user_id: userId, enabled_packs: wanted }, { onConflict: "user_id" });
  if (error) return fail(reasonFor(error));
  return ok({ newlyEnabled: wanted.filter((id) => !before.has(id)) });
}

/** Stamps `last_export_at` (SPEC §12.3) — the one side effect an export has. */
export async function stampExport(client: Db, userId: string, at = new Date()): Promise<ActionResult> {
  const { error } = await client
    .from("user_settings")
    .upsert({ user_id: userId, last_export_at: at.toISOString() }, { onConflict: "user_id" });
  return error ? fail(reasonFor(error)) : ok(undefined);
}
