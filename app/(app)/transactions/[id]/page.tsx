import Link from "next/link";
import { notFound } from "next/navigation";
import { PACKS } from "@/packs";
import { Notice } from "@/app/(app)/_components/notice";
import { fieldsFrom } from "@/app/(app)/_lib/form";
import { requireUser } from "@/lib/auth/session";
import { copyFor } from "@/lib/copy";
import { listAssets } from "@/lib/ledger/queries";
import { readSettings, TRANSACTION_SELECT } from "@/lib/ledger/rows";
import { TransactionForm } from "../_form";
import { updateTransactionAction } from "../actions";

export default async function EditTransactionPage({ params, searchParams }: PageProps<"/transactions/[id]">) {
  const { client } = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const [{ data }, assets, settings] = await Promise.all([
    client.from("transactions").select(`${TRANSACTION_SELECT},note`).eq("id", id).maybeSingle(),
    listAssets(client, PACKS),
    readSettings(client),
  ]);
  if (!data) notFound();
  const copy = copyFor(settings.locale);
  const c = copy.screens.transactions;
  return (
    <main>
      <p className="muted">
        <Link href="/transactions">{c.title}</Link>
      </p>
      <h1>{c.edit}</h1>
      <Notice searchParams={query} />
      <TransactionForm
        action={updateTransactionAction.bind(null, id)}
        assets={assets}
        values={data}
        invalid={fieldsFrom(query)}
        submitLabel={c.save}
        copy={copy}
      />
    </main>
  );
}
