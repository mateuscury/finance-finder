/**
 * Base currency (SPEC §11; decision 26): locked at the first transaction;
 * the reset is one explicit action, after which the decision 20 trigger
 * drops every snapshot and the next run rebuilds history in the new base.
 * The rest of Settings arrives in Phase 6.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, reasonFor, type ActionResult } from "./result";
import { BaseCurrencyInputSchema, failedFields } from "./schemas";

export async function changeBaseCurrency(client: SupabaseClient, userId: string, input: unknown): Promise<ActionResult<{ reset: boolean }>> {
  const parsed = BaseCurrencyInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", failedFields(parsed.error));
  const current = await client.from("user_settings").select("base_currency").eq("user_id", userId).maybeSingle();
  if (current.error) return fail(reasonFor(current.error));
  if (current.data?.base_currency === parsed.data.base_currency) return ok({ reset: false });
  const { count, error } = await client.from("transactions").select("*", { count: "exact", head: true });
  if (error) return fail(reasonFor(error));
  const locked = (count ?? 0) > 0;
  if (locked && !parsed.data.confirmReset) return fail("base_locked", ["base_currency"]);
  const write = await client.from("user_settings").upsert({ user_id: userId, base_currency: parsed.data.base_currency }, { onConflict: "user_id" });
  return write.error ? fail(reasonFor(write.error)) : ok({ reset: locked });
}
