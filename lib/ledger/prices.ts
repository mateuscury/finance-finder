/**
 * Manual prices (SPEC §9.4, §2): `source_id = 'manual'` is the one
 * provenance a client may write, and `commit_ingest_chunk` never overwrites
 * it. An upsert lets a user correct a source's price for a date.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, fromAffected, ok, reasonFor, type ActionResult } from "./result";
import { failedFields, ManualPriceInputSchema } from "./schemas";

export async function setManualPrice(client: SupabaseClient, input: unknown): Promise<ActionResult> {
  const parsed = ManualPriceInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", failedFields(parsed.error));
  const asset = await client.from("assets").select("native_currency").eq("id", parsed.data.asset_id).maybeSingle();
  if (asset.error || !asset.data) return fail("not_found", ["asset_id"]);
  const { error } = await client
    .from("prices")
    .upsert({ asset_id: parsed.data.asset_id, date: parsed.data.date, price: parsed.data.price, currency: asset.data.native_currency, source_id: "manual" }, { onConflict: "asset_id,date" });
  return error ? fail(reasonFor(error)) : ok(undefined);
}

export async function deleteManualPrice(client: SupabaseClient, assetId: string, date: string): Promise<ActionResult> {
  return fromAffected(await client.from("prices").delete().eq("asset_id", assetId).eq("date", date).eq("source_id", "manual").select("date"));
}
