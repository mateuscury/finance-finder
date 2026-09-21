import Link from "next/link";
import { PACKS } from "@/packs";
import { Amount } from "@/app/(app)/_components/amount";
import { ReturnTo } from "@/app/(app)/_components/nav-link";
import { Notice } from "@/app/(app)/_components/notice";
import { ValueStatus } from "@/app/(app)/_components/value-status";
import { refreshAction } from "@/app/(app)/_actions/refresh";
import { copyFor, type ReasonCode } from "@/lib/copy";
import { formatDate, formatPrice } from "@/lib/format";
import { listAssets } from "@/lib/ledger/queries";
import { readSettings } from "@/lib/ledger/rows";
import { requireUser } from "@/lib/auth/session";
import { AssetForm } from "./_form";
import { kindOptions } from "./_kinds";
import { createAssetThen, deleteAssetAction } from "./actions";

// The create action schedules the price-then-snapshot chain after the response (decision 30).
export const maxDuration = 60;

/**
 * Assets (SPEC §9 screen 6; §9.4 outcome on the row; §9.5): the list leads,
 * every row states its price state — priced with source and date, accrues,
 * or unpriced with the reason and the two actions §9.4 names — and the
 * create form sits below in a panel. Manual prices live on the asset page.
 */
export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const { client } = await requireUser();
  const params = await searchParams;
  const [assets, settings] = await Promise.all([listAssets(client, PACKS), readSettings(client)]);
  const copy = copyFor(settings.locale);
  const locale = settings.locale;
  const c = copy.screens.assets;
  const formCopy = { ...copy.screens.assetForm, reasons: copy.reasons };

  return (
    <main>
      <h1>{c.title}</h1>
      <Notice searchParams={params} />
      {assets.length === 0 ? (
        <p className="muted">
          {copy.empty.assets} <Link href="/transactions/import">{copy.empty.assetsImport}</Link>
        </p>
      ) : (
        <table className="stack">
          <thead>
            <tr>
              <th>{c.columns.asset}</th>
              <th>{c.columns.kind}</th>
              <th>{c.columns.currency}</th>
              <th className="num">{c.columns.value}</th>
              <th>{c.columns.actions}</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id}>
                <td data-label={c.columns.asset}>
                  <span>
                    <Link href={`/assets/${a.id}`}>{a.identifier}</Link> <span className="muted">{a.name}</span>
                  </span>
                </td>
                <td data-label={c.columns.kind}>{a.kindLabel ?? c.unknownKind({ kind: a.instrument_kind })}</td>
                <td data-label={c.columns.currency}>{a.native_currency}</td>
                <td data-label={c.columns.value} className="num">
                  {a.latest ? (
                    <span>
                      <Amount value={formatPrice(a.latest.price, locale)} hiddenLabel={copy.nav.amountHidden} />{" "}
                      <small className="muted">
                        {c.priced({ source: a.latest.sourceId, date: formatDate(a.latest.date, locale) })}
                      </small>
                    </span>
                  ) : a.valuation === "accrual" ? (
                    <ValueStatus copy={copy} status="accrues" />
                  ) : (
                    <span>
                      <ValueStatus
                        copy={copy}
                        status="unpriced"
                        reason={
                          a.sourceError
                            ? `${a.sourceId}: ${copy.status.reasons[a.sourceError as ReasonCode] ?? a.sourceError}`
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
                        <Link href={`/assets/${a.id}#prices`}>{c.enterPrice}</Link>
                      </span>
                    </span>
                  )}
                </td>
                <td data-label={c.columns.actions} className="actions">
                  <Link href={`/assets/${a.id}`}>{c.editLink}</Link>
                  <form action={deleteAssetAction}>
                    <input type="hidden" name="asset_id" value={a.id} />
                    <button type="submit" className="quiet">
                      {c.delete}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    </main>
  );
}
