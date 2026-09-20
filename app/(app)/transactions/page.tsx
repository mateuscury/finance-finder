import Link from "next/link";
import { PACKS } from "@/packs";
import { Notice } from "@/app/(app)/_components/notice";
import { Pager, pageNumber } from "@/app/(app)/_components/pager";
import { requireUser } from "@/lib/auth/session";
import { listAssets, listTransactions } from "@/lib/ledger/queries";
import { TransactionForm } from "./_form";
import { createTransactionAction, deleteTransactionAction } from "./actions";

// Server-action route budget (decision 30); kept in step with the cron routes.
export const maxDuration = 60;

/** Transactions (SPEC §9 screen 7). CSV import arrives in Phase 5. */
export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const { client } = await requireUser();
  const params = await searchParams;
  const page = pageNumber(params.page);
  const [result, assets] = await Promise.all([listTransactions(client, page), listAssets(client, PACKS)]);
  return (
    <main>
      <h1>Transactions</h1>
      <Notice searchParams={params} />
      {typeof params.imported === "string" ? (
        <p role="status">
          Imported {params.imported} transactions{typeof params.skipped === "string" && params.skipped !== "0" ? `, skipped ${params.skipped} duplicates` : ""}.
        </p>
      ) : null}
      {result.total === 0 ? (
        <p>
          No transactions yet. Add one below, or <Link href="/transactions/import">import a CSV</Link>.
        </p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Asset</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>Unit price</th>
                <th>Fees</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((t) => (
                <tr key={t.id}>
                  <td>{t.trade_date}</td>
                  <td>
                    {t.identifier} — {t.assetName}
                  </td>
                  <td>{t.type}</td>
                  <td>{t.quantity}</td>
                  <td>
                    {t.unit_price} {t.currency}
                  </td>
                  <td>{t.fees}</td>
                  <td>
                    <Link href={`/transactions/${t.id}`}>Edit</Link>{" "}
                    <form action={deleteTransactionAction}>
                      <input type="hidden" name="transaction_id" value={t.id} />
                      <button type="submit">Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager href="/transactions" page={page} total={result.total} />
        </>
      )}
      <h2>Add a transaction</h2>
      {assets.length === 0 ? (
        <p>
          <Link href="/assets">Add an asset</Link> first.
        </p>
      ) : (
        <TransactionForm action={createTransactionAction} assets={assets} submitLabel="Add transaction" />
      )}
    </main>
  );
}
