import Link from "next/link";
import { Notice } from "@/app/(app)/_components/notice";
import { Pager, pageNumber } from "@/app/(app)/_components/pager";
import { requireUser } from "@/lib/auth/session";
import { listCashFlows } from "@/lib/ledger/queries";
import { readSettings } from "@/lib/ledger/rows";
import { CashFlowForm } from "./_form";
import { createCashFlowAction, deleteCashFlowAction } from "./actions";

// Server-action route budget (decision 30); kept in step with the cron routes.
export const maxDuration = 60;

/** Cash flows (SPEC §9 screen 8). */
export default async function CashFlowsPage({ searchParams }: PageProps<"/cash-flows">) {
  const { client } = await requireUser();
  const params = await searchParams;
  const page = pageNumber(params.page);
  const [result, settings] = await Promise.all([listCashFlows(client, page), readSettings(client)]);
  const base = settings.base_currency;
  return (
    <main>
      <h1>Cash flows</h1>
      <Notice searchParams={params} />
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
                <th></th>
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
                  <td>
                    <Link href={`/cash-flows/${f.id}`}>Edit</Link>{" "}
                    <form action={deleteCashFlowAction}>
                      <input type="hidden" name="cash_flow_id" value={f.id} />
                      <button type="submit">Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager href="/cash-flows" page={page} total={result.total} />
        </>
      )}
      <h2>Add a cash flow</h2>
      <CashFlowForm action={createCashFlowAction} baseCurrency={base} submitLabel="Add" />
    </main>
  );
}
