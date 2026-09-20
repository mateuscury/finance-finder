import { notFound } from "next/navigation";
import { Notice } from "@/app/(app)/_components/notice";
import { requireUser } from "@/lib/auth/session";
import { CASH_FLOW_SELECT, type CashFlowDbRow } from "@/lib/ledger/rows";
import { CashFlowForm } from "../_form";
import { updateCashFlowAction } from "../actions";

export default async function EditCashFlowPage({ params, searchParams }: PageProps<"/cash-flows/[id]">) {
  const { client } = await requireUser();
  const { id } = await params;
  const { data } = await client.from("cash_flows").select(`${CASH_FLOW_SELECT},note`).eq("id", id).maybeSingle();
  if (!data) notFound();
  const f = data as CashFlowDbRow & { note: string | null };
  return (
    <main>
      <h1>Edit cash flow</h1>
      <Notice searchParams={await searchParams} />
      <CashFlowForm action={updateCashFlowAction.bind(null, id)} baseCurrency={f.currency} values={f} submitLabel="Save" />
    </main>
  );
}
