import Link from "next/link";
import { PACKS } from "@/packs";
import { Amount } from "@/app/(app)/_components/amount";
import { Change } from "@/app/(app)/_components/change";
import { ReturnTo } from "@/app/(app)/_components/nav-link";
import { Notice } from "@/app/(app)/_components/notice";
import { ValueStatus } from "@/app/(app)/_components/value-status";
import { refreshAction } from "@/app/(app)/_actions/refresh";
import { valueLedger } from "@/app/(app)/_lib/valuation";
import { holdingsModel, type HoldingModelRow } from "@/app/(app)/_models/holdings";
import { todayIso } from "@/lib/clock";
import { copyFor, type ReasonCode } from "@/lib/copy";
import { formatDate, formatMoney, formatQuantity } from "@/lib/format";
import { listAssets } from "@/lib/ledger/queries";
import { readLedger, readSettings, toPortfolioInput } from "@/lib/ledger/rows";
import { requireUser } from "@/lib/auth/session";
import { AssetForm } from "./_form";
import { kindOptions } from "./_kinds";
import { createAssetThen, deleteAssetAction } from "./actions";

// The create action schedules the price-then-snapshot chain after the response (decision 30).
export const maxDuration = 60;

/**
 * Assets (SPEC §9 screen 6; §9.4 outcome on the row; §9.5; §11) — the
 * positions screen and the registry in one (decision 60). Each row states
 * what is held, what it cost (before fees, decision 59), what it is worth and
 * what it has gained; the foot carries the confident total, which is the same
 * number the Overview headline shows. The create form sits below in a panel
 * so the list leads. Manual prices live on the asset's own page.
 */
export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const { client } = await requireUser();
  const params = await searchParams;
  const today = todayIso();
  const [assets, read, settings] = await Promise.all([
    listAssets(client, PACKS),
    readLedger(client, PACKS, { prices: "latest" }),
    readSettings(client),
  ]);
  const copy = copyFor(settings.locale);
  const locale = settings.locale;
  const c = copy.screens.assets;
  const formCopy = { ...copy.screens.assetForm, reasons: copy.reasons };

  const { valuation } = valueLedger(toPortfolioInput(read), today);
  const model = holdingsModel({
    valuation,
    transactions: read.transactions,
    assets,
    baseCurrency: settings.base_currency,
    today,
  });

  const money = (value: string, currency: string) => (
    <Amount value={formatMoney(value, currency, locale)} hiddenLabel={copy.nav.amountHidden} />
  );
  const untraded = <span className="muted">{c.untraded}</span>;

  /** The price cell: the figure, or the state and the two actions §9.4 names. */
  const priceCell = (row: HoldingModelRow) => {
    if (row.ledgerError !== null) return untraded;
    if (row.price !== null) {
      return (
        <span>
          {money(row.price.native, row.currency)}
          {row.status === "ok" ? (
            row.sourceId ? (
              <>
                {" "}
                <small className="muted">
                  {c.priced({ source: row.sourceId, date: formatDate(row.price.date, locale) })}
                </small>
              </>
            ) : null
          ) : (
            <>
              {" "}
              <ValueStatus copy={copy} status={row.status} date={row.statusDate} />
            </>
          )}
        </span>
      );
    }
    if (row.status === "accrues") return <ValueStatus copy={copy} status="accrues" />;
    return (
      <span>
        <ValueStatus
          copy={copy}
          status="unpriced"
          reason={
            row.reason
              ? `${row.sourceId ? `${row.sourceId}: ` : ""}${copy.status.reasons[row.reason as ReasonCode] ?? row.reason}`
              : null
          }
        />
        <span className="actions">
          {" "}
          <form action={refreshAction}>
            <ReturnTo />
            <button type="submit" className="quiet">
              {c.retry}
            </button>
          </form>
          <Link href={`/assets/${row.assetId}#prices`}>{c.enterPrice}</Link>
        </span>
      </span>
    );
  };

  return (
    <main>
      <h1>{c.title}</h1>
      <Notice searchParams={params} />
      {model.ledgerErrors > 0 ? <p role="alert">{copy.errors.ledger({ n: model.ledgerErrors })}</p> : null}
      {assets.length === 0 ? (
        <p className="muted">
          {copy.empty.assets} <Link href="/transactions/import">{copy.empty.assetsImport}</Link>
        </p>
      ) : (
        // Six columns, two of them carrying a paired figure beneath the main
        // one: quantity with its average cost, value with its unrealised
        // gain. Still wider than a narrow desktop, so it scrolls inside its
        // own container and never the page (SPEC §10); under 640 px
        // `table.stack` turns each row into a card instead.
        <div className="table-scroll">
          <table className="stack">
            <thead>
              <tr>
                <th>{c.columns.asset}</th>
                <th>{c.columns.kind}</th>
                <th className="num">{c.columns.quantity}</th>
                <th className="num">{c.columns.price}</th>
                <th className="num">{c.columns.value}</th>
                <th>{c.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.assetId}>
                  <td data-label={c.columns.asset}>
                    <span>
                      <Link href={`/assets/${row.assetId}`}>{row.identifier}</Link>
                      {row.name === row.identifier ? null : <span className="muted"> {row.name}</span>}
                    </span>
                  </td>
                  <td data-label={c.columns.kind}>{row.kindLabel ?? c.unknownKind({ kind: row.instrumentKind })}</td>
                  <td data-label={c.columns.quantity} className="num">
                    {row.ledgerError !== null ? (
                      <ValueStatus copy={copy} status="unpriced" reason={copy.status.reasons.oversell} />
                    ) : row.quantity === "0" ? (
                      untraded
                    ) : (
                      <>
                        <Amount value={formatQuantity(row.quantity, locale)} hiddenLabel={copy.nav.amountHidden} />
                        {row.averageCost === null ? null : (
                          <>
                            <br />
                            <small className="muted nowrap">
                              {c.columns.averageCost} {money(row.averageCost, row.currency)}
                            </small>
                          </>
                        )}
                      </>
                    )}
                  </td>
                  <td data-label={c.columns.price} className="num">
                    {priceCell(row)}
                  </td>
                  <td data-label={c.columns.value} className="num">
                    {row.marketValueBase === null ? untraded : money(row.marketValueBase, model.baseCurrency)}
                    {row.unrealised === null ? null : (
                      <>
                        <br />
                        <small className="nowrap">
                          <Change
                            delta={row.unrealised.delta}
                            rate={row.unrealised.rate}
                            currency={row.currency}
                            locale={locale}
                            copy={copy}
                          />
                        </small>
                      </>
                    )}
                  </td>
                  <td data-label={c.columns.actions} className="actions">
                    <Link href={`/assets/${row.assetId}`}>{c.editLink}</Link>
                    <form action={deleteAssetAction}>
                      <input type="hidden" name="asset_id" value={row.assetId} />
                      <button type="submit" className="quiet">
                        {c.delete}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
            {model.totalBase === null ? null : (
              <tfoot>
                <tr>
                  <th scope="row" colSpan={4}>
                    {c.total}
                    {model.outsideTotal > 0 ? (
                      <>
                        {" "}
                        <span className="muted">· {c.outsideTotal({ n: model.outsideTotal })}</span>
                      </>
                    ) : null}
                  </th>
                  <td className="num">{money(model.totalBase, model.baseCurrency)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <details className="panel" open={assets.length === 0}>
        <summary>{c.add}</summary>
        <AssetForm
          action={createAssetThen.bind(null, "/assets")}
          kinds={kindOptions(PACKS)}
          submitLabel={c.addButton}
          copy={formCopy}
        />
      </details>
      {assets.length > 0 ? <p className="muted">{c.asOf({ date: formatDate(today, locale) })}</p> : null}
    </main>
  );
}
