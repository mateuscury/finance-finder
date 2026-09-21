"use server";
/** Cash-flow actions (SPEC §9 screen 8; decision 25: base currency only). */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createCashFlow, deleteCashFlow, updateCashFlow } from "@/lib/ledger/cashFlows";
import { readSettings } from "@/lib/ledger/rows";
import { formValues, outcomeQuery } from "@/app/(app)/_lib/form";

const baseCurrency = async (client: Awaited<ReturnType<typeof requireUser>>["client"]): Promise<string> =>
  (await readSettings(client)).base_currency;

export async function createCashFlowAction(formData: FormData): Promise<void> {
  const { client, identity } = await requireUser();
  const result = await createCashFlow(
    client,
    identity.userId,
    await baseCurrency(client),
    formValues(formData, ["date", "amount", "note"] as const),
  );
  if (result.ok) {
    revalidatePath("/cash-flows");
    revalidatePath("/");
  }
  redirect(`/cash-flows${outcomeQuery(result)}`);
}

export async function updateCashFlowAction(cashFlowId: string, formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const result = await updateCashFlow(
    client,
    cashFlowId,
    await baseCurrency(client),
    formValues(formData, ["date", "amount", "note"] as const),
  );
  if (result.ok) {
    revalidatePath("/cash-flows");
    redirect("/cash-flows?saved=1");
  }
  redirect(`/cash-flows/${cashFlowId}${outcomeQuery(result)}`);
}

export async function deleteCashFlowAction(formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const { cash_flow_id } = formValues(formData, ["cash_flow_id"] as const);
  const result = await deleteCashFlow(client, cash_flow_id ?? "");
  if (result.ok) revalidatePath("/cash-flows");
  redirect(`/cash-flows${outcomeQuery(result)}`);
}
