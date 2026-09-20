import { notFound } from "next/navigation";
import { PACKS } from "@/packs";
import { Notice } from "@/app/(app)/_components/notice";
import { requireUser } from "@/lib/auth/session";
import { listAssets } from "@/lib/ledger/queries";
import { TRANSACTION_SELECT, type TransactionDbRow } from "@/lib/ledger/rows";
import { TransactionForm } from "../_form";
import { updateTransactionAction } from "../actions";

export default async function EditTransactionPage({ params, searchParams }: PageProps<"/transactions/[id]">) {
  const { client } = await requireUser();
  const { id } = await params;
  const [{ data }, assets] = await Promise.all([client.from("transactions").select(`${TRANSACTION_SELECT},note`).eq("id", id).maybeSingle(), listAssets(client, PACKS)]);
  if (!data) notFound();
  const t = data as TransactionDbRow & { note: string | null };
  return (
    <main>
      <h1>Edit transaction</h1>
      <Notice searchParams={await searchParams} />
      <TransactionForm action={updateTransactionAction.bind(null, id)} assets={assets} values={t} submitLabel="Save" />
    </main>
  );
}
