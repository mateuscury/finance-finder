/**
 * Cash-flow writes (SPEC §9 screen 8; decision 25): deposits and
 * withdrawals in the BASE currency only — the action writes it, the form
 * never asks. They enter TWR/MWR at read time and touch no snapshot.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, fromAffected, ok, reasonFor, type ActionResult } from "./result";
import { CashFlowInputSchema, failedFields } from "./schemas";

export async function createCashFlow(
  client: SupabaseClient,
  userId: string,
  baseCurrency: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = CashFlowInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", failedFields(parsed.error));
  const { data, error } = await client
    .from("cash_flows")
    .insert({ user_id: userId, currency: baseCurrency, ...parsed.data })
    .select("id")
    .single();
  if (error || !data) return fail(reasonFor(error));
  return ok({ id: data.id as string });
}

export async function updateCashFlow(
  client: SupabaseClient,
  cashFlowId: string,
  baseCurrency: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = CashFlowInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", failedFields(parsed.error));
  return fromAffected(
    await client
      .from("cash_flows")
      .update({ currency: baseCurrency, ...parsed.data })
      .eq("id", cashFlowId)
      .select("id"),
  );
}

export async function deleteCashFlow(client: SupabaseClient, cashFlowId: string): Promise<ActionResult> {
  return fromAffected(await client.from("cash_flows").delete().eq("id", cashFlowId).select("id"));
}
