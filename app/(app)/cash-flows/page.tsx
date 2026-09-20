import { Pager, pageNumber } from "@/app/(app)/_components/pager";
import { requireUser } from "@/lib/auth/session";
import { listCashFlows } from "@/lib/ledger/queries";

/** Cash flows list (SPEC §9 screen 8). The form arrives in Phase 4. */
export default async function CashFlowsPage({ searchParams }: PageProps<"/cash-flows">) {
  const { client } = await requireUser();
  const { page: pageParam } = await searchParams;
  const page = pageNumber(pageParam);
  const result = await listCashFlows(client, page);
  return (
    <main>
      <h1>Cash flows</h1>
      {result.total === 0 ? (
        <p>Deposits and withdrawals are what separate your return from your contributions.</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((f) => (
                <tr key={f.id}>
                  <td>{f.date}</td>
                  <td>
                    {f.amount} {f.currency}
                  </td>
                  <td>{f.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager href="/cash-flows" page={page} total={result.total} />
        </>
      )}
    </main>
  );
}
