/**
 * Transaction writes (SPEC §9 screen 7, §1.1). Editing or deleting one
 * recomputes everything downstream: the decision 20 trigger drops the
 * snapshots from the touched date on, and the next job run rebuilds them.
 */
import type { Db } from "@/lib/supabase/types";
import { isKernelError } from "@/lib/calc/errors";
import { lotsAt } from "@/lib/calc/positions";
import type { LedgerTransaction } from "@/lib/calc/types";
import { readAll } from "@/lib/supabase/paginate";
import { fail, fromAffected, ok, reasonFor, type ActionResult } from "./result";
import { TRANSACTION_SELECT, toTransaction, type TransactionDbRow } from "./rows";
import { failedFields, TransactionInputSchema, type TransactionInput } from "./schemas";

async function ownsAsset(client: Db, assetId: string): Promise<boolean> {
  const { data, error } = await client.from("assets").select("id").eq("id", assetId).maybeSingle();
  return !error && data !== null;
}

/**
 * Would this row leave the asset selling more than it ever bought?
 * (SPEC §6, §11; MILESTONES.md §4 decision 58.)
 *
 * The database checks only the quantity's SIGN, so without this a too-large
 * sell is written happily — and from then on `lotsAt` throws for that asset,
 * `valuePortfolio` throws for the whole portfolio, and every analysis screen
 * is an error page until someone finds the row by hand. Refusing at the
 * write names the row instead.
 *
 * The check runs over the asset's whole ledger with the candidate row
 * substituted (on an edit) or appended (on a create), because FIFO order is
 * by trade date: a backdated sell can invalidate rows that already exist.
 */
async function wouldOversell(client: Db, input: TransactionInput, replacing: string | null): Promise<boolean> {
  if (input.type !== "sell" && replacing === null) return false;
  const rows = await readAll<TransactionDbRow>((from, to) =>
    client
      .from("transactions")
      .select(TRANSACTION_SELECT)
      .eq("asset_id", input.asset_id)
      .order("trade_date")
      .order("id")
      .range(from, to),
  );
  const candidate: LedgerTransaction = {
    id: replacing ?? "pending",
    assetId: input.asset_id,
    tradeDate: input.trade_date,
    type: input.type,
    quantity: input.quantity,
    unitPrice: input.unit_price,
    currency: input.currency,
    fees: input.fees,
    fxRate: null,
  };
  const ledger = rows
    .filter((r) => r.id !== replacing)
    .map(toTransaction)
    .concat(candidate);
  try {
    lotsAt(ledger, "9999-12-31");
    return false;
  } catch (err) {
    if (isKernelError(err, "oversell")) return true;
    throw err;
  }
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
  if (await wouldOversell(client, parsed.data, null)) return fail("oversell", ["quantity"]);
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
  // An edit is checked too: lowering a buy's quantity can leave later sells
  // uncovered even though the edited row is itself a buy.
  if (await wouldOversell(client, parsed.data, transactionId)) return fail("oversell", ["quantity"]);
  return fromAffected(await client.from("transactions").update(parsed.data).eq("id", transactionId).select("id"));
}

export async function deleteTransaction(client: Db, transactionId: string): Promise<ActionResult> {
  return fromAffected(await client.from("transactions").delete().eq("id", transactionId).select("id"));
}
