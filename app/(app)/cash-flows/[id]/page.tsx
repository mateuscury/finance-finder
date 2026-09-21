import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/app/(app)/_components/notice";
import { fieldsFrom } from "@/app/(app)/_lib/form";
import { requireUser } from "@/lib/auth/session";
import { copyFor } from "@/lib/copy";
import { CASH_FLOW_SELECT, readSettings } from "@/lib/ledger/rows";
import { CashFlowForm } from "../_form";
import { updateCashFlowAction } from "../actions";

export default async function EditCashFlowPage({ params, searchParams }: PageProps<"/cash-flows/[id]">) {
  const { client } = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const [{ data }, settings] = await Promise.all([
    client.from("cash_flows").select(`${CASH_FLOW_SELECT},note`).eq("id", id).maybeSingle(),
    readSettings(client),
  ]);
  if (!data) notFound();
  const copy = copyFor(settings.locale);
  const c = copy.screens.cashFlows;
  return (
    <main>
      <p className="muted">
        <Link href="/cash-flows">{c.backToList}</Link>
      </p>
      <h1>{c.editTitle}</h1>
      <Notice searchParams={query} />
      <CashFlowForm
        action={updateCashFlowAction.bind(null, id)}
        baseCurrency={data.currency}
        values={data}
        invalid={fieldsFrom(query)}
        submitLabel={c.saveButton}
        copy={copy}
      />
    </main>
  );
}
