import { Pager, pageNumber } from "@/app/(app)/_components/pager";
import { requireUser } from "@/lib/auth/session";
import { listTransactions } from "@/lib/ledger/queries";

/** Transactions list (SPEC §9 screen 7). Forms and CSV import arrive in Phases 4 and 5. */
export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const { client } = await requireUser();
  const { page: pageParam } = await searchParams;
  const page = pageNumber(pageParam);
  const result = await listTransactions(client, page);
  return (
    <main>
      <h1>Transactions</h1>
      {result.total === 0 ? (
        <p>No transactions yet.</p>
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
                </tr>
              ))}
            </tbody>
          </table>
          <Pager href="/transactions" page={page} total={result.total} />
        </>
      )}
    </main>
  );
}
