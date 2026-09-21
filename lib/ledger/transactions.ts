/**
 * Transaction writes (SPEC §9 screen 7, §1.1). Editing or deleting one
 * recomputes everything downstream: the decision 20 trigger drops the
 * snapshots from the touched date on, and the next job run rebuilds them.
 */
import type { Db } from "@/lib/supabase/types";
import { fail, fromAffected, ok, reasonFor, type ActionResult } from "./result";
import { failedFields, TransactionInputSchema } from "./schemas";

async function ownsAsset(client: Db, assetId: string): Promise<boolean> {
  const { data, error } = await client.from("assets").select("id").eq("id", assetId).maybeSingle();
  return !error && data !== null;
}

export async function createTransaction(
  client: Db,
  userId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = TransactionInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", failedFields(parsed.error));
  // A friendly not_found before the composite FK says the same thing less kindly.
  if (!(await ownsAsset(client, parsed.data.asset_id))) return fail("not_found", ["asset_id"]);
  const { data, error } = await client
    .from("transactions")
    .insert({ user_id: userId, ...parsed.data })
    .select("id")
    .single();
  if (error || !data) return fail(reasonFor(error));
  return ok({ id: data.id as string });
}

export async function updateTransaction(client: Db, transactionId: string, input: unknown): Promise<ActionResult> {
  const parsed = TransactionInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", failedFields(parsed.error));
  if (!(await ownsAsset(client, parsed.data.asset_id))) return fail("not_found", ["asset_id"]);
  return fromAffected(await client.from("transactions").update(parsed.data).eq("id", transactionId).select("id"));
}

export async function deleteTransaction(client: Db, transactionId: string): Promise<ActionResult> {
  return fromAffected(await client.from("transactions").delete().eq("id", transactionId).select("id"));
}
