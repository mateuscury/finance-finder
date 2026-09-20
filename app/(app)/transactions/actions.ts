"use server";
/** Transaction actions (SPEC §9 screen 7, §1.1). Edits recompute everything downstream through the decision 20 trigger. */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createTransaction, deleteTransaction, updateTransaction } from "@/lib/ledger/transactions";
import { formValues, outcomeQuery } from "@/app/(app)/_lib/form";

const FIELDS = ["asset_id", "trade_date", "type", "quantity", "unit_price", "currency", "fees", "note"] as const;

/** A form's fees default to "0" and an empty note to null. */
function input(formData: FormData) {
  const v = formValues(formData, FIELDS);
  return { ...v, fees: v.fees ?? "0" };
}

export async function createTransactionAction(formData: FormData): Promise<void> {
  const { client, identity } = await requireUser();
  const result = await createTransaction(client, identity.userId, input(formData));
  if (result.ok) {
    revalidatePath("/transactions");
    revalidatePath("/");
  }
  redirect(`/transactions${outcomeQuery(result)}`);
}

export async function updateTransactionAction(transactionId: string, formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const result = await updateTransaction(client, transactionId, input(formData));
  if (result.ok) {
    revalidatePath("/transactions");
    redirect("/transactions?saved=1");
  }
  redirect(`/transactions/${transactionId}${outcomeQuery(result)}`);
}

export async function deleteTransactionAction(formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const { transaction_id } = formValues(formData, ["transaction_id"] as const);
  const result = await deleteTransaction(client, transaction_id ?? "");
  if (result.ok) revalidatePath("/transactions");
  redirect(`/transactions${outcomeQuery(result)}`);
}
