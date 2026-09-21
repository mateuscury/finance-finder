import Link from "next/link";
import { Amount } from "@/app/(app)/_components/amount";
import { Notice } from "@/app/(app)/_components/notice";
import { Pager, pageNumber } from "@/app/(app)/_components/pager";
import { fieldsFrom } from "@/app/(app)/_lib/form";
import { requireUser } from "@/lib/auth/session";
import { copyFor } from "@/lib/copy";
import { formatChange, formatDate } from "@/lib/format";
import { listCashFlows } from "@/lib/ledger/queries";
import { readSettings } from "@/lib/ledger/rows";
import { CashFlowForm } from "./_form";
import { createCashFlowAction, deleteCashFlowAction } from "./actions";

// Server-action route budget (decision 30); kept in step with the cron routes.
export const maxDuration = 60;

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Cash flows (SPEC §9 screen 8; §9.5): the list leads, signed amounts in
 * the base currency (a deposit positive, a withdrawal negative), the form
 * in a panel below.
 */
export default async function CashFlowsPage({ searchParams }: PageProps<"/cash-flows">) {
  const { client } = await requireUser();
  const params = await searchParams;
  const page = pageNumber(params.page);
  const [result, settings] = await Promise.all([listCashFlows(client, page), readSettings(client)]);
  const base = settings.base_currency;
  const locale = settings.locale;
  const copy = copyFor(locale);
  const c = copy.screens.cashFlows;
  const invalid = fieldsFrom(params);
  const openPanel = result.total === 0 || invalid.size > 0 || first(params.error) !== undefined;

  return (
    <main>
      <h1>{c.title}</h1>
      <Notice searchParams={params} />
      {result.total === 0 ? (
        <p className="muted">{copy.empty.cashFlows}</p>
      ) : (
        <>
          <table className="stack">
            <thead>
              <tr>
                <th>{c.columns.date}</th>
                <th className="num">{c.columns.amount}</th>
                <th>{c.columns.note}</th>
                <th>{c.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((f) => {
                const change = formatChange(f.amount, f.currency, locale);
                return (
                  <tr key={f.id}>
                    <td data-label={c.columns.date} className="figure">
                      {formatDate(f.date, locale)}
                    </td>
                    <td data-label={c.columns.amount} className="num">
                      <Amount
                        value={change.text}
                        hiddenLabel={copy.nav.amountHidden}
                        className={change.direction === "zero" ? undefined : change.direction}
                      />
                    </td>
                    <td data-label={c.columns.note}>{f.note ?? ""}</td>
                    <td data-label={c.columns.actions} className="actions">
                      <Link href={`/cash-flows/${f.id}`}>{c.edit}</Link>
                      <form action={deleteCashFlowAction}>
                        <input type="hidden" name="cash_flow_id" value={f.id} />
                        <button type="submit" className="quiet">
                          {c.delete}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager href="/cash-flows" page={page} total={result.total} copy={copy} />
        </>
      )}
      <details className="panel" open={openPanel}>
        <summary>{c.add}</summary>
        <CashFlowForm
          action={createCashFlowAction}
          baseCurrency={base}
          invalid={invalid}
          submitLabel={c.addButton}
          copy={copy}
        />
      </details>
    </main>
  );
}
