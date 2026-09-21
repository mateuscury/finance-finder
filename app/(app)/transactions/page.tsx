import Link from "next/link";
import { PACKS } from "@/packs";
import { Amount } from "@/app/(app)/_components/amount";
import { Notice } from "@/app/(app)/_components/notice";
import { Pager, pageNumber } from "@/app/(app)/_components/pager";
import { fieldsFrom } from "@/app/(app)/_lib/form";
import { requireUser } from "@/lib/auth/session";
import { copyFor } from "@/lib/copy";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import { listAssets, listTransactions } from "@/lib/ledger/queries";
import { readSettings } from "@/lib/ledger/rows";
import { TransactionForm } from "./_form";
import { createTransactionAction, deleteTransactionAction } from "./actions";

// Server-action route budget (decision 30); kept in step with the cron routes.
export const maxDuration = 60;

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Transactions (SPEC §9 screen 7; §9.5): the list leads, the form sits in a
 * panel below; `?asset=<id>` (from Maturities' "record the sell") opens the
 * panel with that asset and a sell pre-selected.
 */
export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const { client } = await requireUser();
  const params = await searchParams;
  const page = pageNumber(params.page);
  const [result, assets, settings] = await Promise.all([
    listTransactions(client, page),
    listAssets(client, PACKS),
    readSettings(client),
  ]);
  const copy = copyFor(settings.locale);
  const locale = settings.locale;
  const c = copy.screens.transactions;
  const preselect = first(params.asset);
  const imported = first(params.imported);
  const invalid = fieldsFrom(params);
  const openPanel =
    result.total === 0 || preselect !== undefined || invalid.size > 0 || first(params.error) !== undefined;

  return (
    <main>
      <h1>{c.title}</h1>
      <Notice searchParams={params} />
      {imported ? (
        <p role="status">
          {c.imported({ n: parseInt(imported, 10) || 0, skipped: parseInt(first(params.skipped) ?? "0", 10) || 0 })}
        </p>
      ) : null}
      {result.total === 0 ? (
        <p className="muted">
          {copy.empty.transactions} <Link href="/transactions/import">{c.import}</Link>
        </p>
      ) : (
        <>
          <table className="stack">
            <thead>
              <tr>
                <th>{c.columns.date}</th>
                <th>{c.columns.asset}</th>
                <th>{c.columns.type}</th>
                <th className="num">{c.columns.quantity}</th>
                <th className="num">{c.columns.unitPrice}</th>
                <th className="num">{c.columns.fees}</th>
                <th>{c.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((t) => (
                <tr key={t.id}>
                  <td data-label={c.columns.date} className="figure">
                    {formatDate(t.trade_date, locale)}
                  </td>
                  <td data-label={c.columns.asset}>
                    <span>
                      <Link href={`/assets/${t.asset_id}`}>{t.identifier}</Link>{" "}
                      <span className="muted">{t.assetName}</span>
                    </span>
                  </td>
                  <td data-label={c.columns.type}>{c.types[t.type]}</td>
                  <td data-label={c.columns.quantity} className="num">
                    <Amount value={formatQuantity(t.quantity, locale)} hiddenLabel={copy.nav.amountHidden} />
                  </td>
                  <td data-label={c.columns.unitPrice} className="num">
                    <span className="nowrap">
                      <Amount value={formatPrice(t.unit_price, locale)} hiddenLabel={copy.nav.amountHidden} />{" "}
                      <span className="muted">{t.currency}</span>
                    </span>
                  </td>
                  <td data-label={c.columns.fees} className="num">
                    <Amount value={formatPrice(t.fees, locale)} hiddenLabel={copy.nav.amountHidden} />
                  </td>
                  <td data-label={c.columns.actions} className="actions">
                    <Link href={`/transactions/${t.id}`}>{c.edit}</Link>
                    <form action={deleteTransactionAction}>
                      <input type="hidden" name="transaction_id" value={t.id} />
                      <button type="submit" className="quiet">
                        {c.delete}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager href="/transactions" page={page} total={result.total} copy={copy} />
        </>
      )}
      <details className="panel" open={openPanel}>
        <summary>{c.add}</summary>
        {assets.length === 0 ? (
          <p className="muted">
            <Link href="/assets">{c.addAssetFirst}</Link>
          </p>
        ) : (
          <TransactionForm
            action={createTransactionAction}
            assets={assets}
            values={preselect ? { asset_id: preselect, type: "sell" } : {}}
            invalid={invalid}
            submitLabel={c.addButton}
            copy={copy}
          />
        )}
      </details>
      <p className="muted">
        <Link href="/transactions/import">{c.import}</Link>
      </p>
    </main>
  );
}
