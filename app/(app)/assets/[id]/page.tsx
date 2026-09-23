import Link from "next/link";
import { notFound } from "next/navigation";
import { PACKS } from "@/packs";
import { Amount } from "@/app/(app)/_components/amount";
import { Notice } from "@/app/(app)/_components/notice";
import { fieldsFrom } from "@/app/(app)/_lib/form";
import { requireUser } from "@/lib/auth/session";
import { copyFor } from "@/lib/copy";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import { readAll } from "@/lib/supabase/paginate";
import { ASSET_SELECT, TRANSACTION_SELECT, readSettings, toTransaction } from "@/lib/ledger/rows";
import type { TransactionDbRow } from "@/lib/ledger/rows";
import { isKernelError } from "@/lib/calc/errors";
import { averageCost, lotQuantity, lotsAt, openCost } from "@/lib/calc/positions";
import { toDecimalString } from "@/lib/calc/decimal";
import { todayIso } from "@/lib/clock";
import { AssetForm } from "../_form";
import { kindOptions } from "../_kinds";
import { deleteManualPriceAction, setManualPriceAction, updateAssetAction } from "../actions";

/**
 * One asset (SPEC §9 screen 6, §6, §9.4): the edit form — identity locked
 * once traded (decision 27) — then its **open lots**, which are what a sell
 * consumes next and where its average cost comes from, and its manual
 * prices, which a source never overwrites (SPEC §2). `#prices` is where the
 * list's "Enter a price" lands; `#position` is where its figures come from.
 */
export default async function EditAssetPage({ params, searchParams }: PageProps<"/assets/[id]">) {
  const { client } = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const [{ data }, settings] = await Promise.all([
    client.from("assets").select(ASSET_SELECT).eq("id", id).maybeSingle(),
    readSettings(client),
  ]);
  if (!data) notFound();
  const asset = data;
  const copy = copyFor(settings.locale);
  const locale = settings.locale;
  const c = copy.screens.assets;
  const [{ count }, manual, txnRows] = await Promise.all([
    client.from("transactions").select("*", { count: "exact", head: true }).eq("asset_id", id),
    readAll<{ date: string; price: string }>((from, to) =>
      client
        .from("prices")
        .select("date,price::text")
        .eq("asset_id", id)
        .eq("source_id", "manual")
        .order("date", { ascending: false })
        .range(from, to),
    ),
    readAll<TransactionDbRow>((from, to) =>
      client
        .from("transactions")
        .select(TRANSACTION_SELECT)
        .eq("asset_id", id)
        .order("trade_date")
        .order("id")
        .range(from, to),
    ),
  ]);
  const locked = (count ?? 0) > 0;
  const today = todayIso();
  // The open lots behind this holding (SPEC §6). An inconsistent ledger is
  // shown as such, never as a crash — the same rule every screen follows.
  let lots;
  let oversold = false;
  try {
    lots = lotsAt(txnRows.map(toTransaction), today);
  } catch (err) {
    if (!isKernelError(err, "oversell")) throw err;
    lots = [];
    oversold = true;
  }
  const quantity = lotQuantity(lots);
  const cost = lots.length > 0 ? openCost(lots, asset.native_currency).amount : null;
  const average = averageCost(lots);
  const invalid = fieldsFrom(query);
  const kind = PACKS.find((p) => p.id === asset.pack_id)?.instruments.find((k) => k.id === asset.instrument_kind);
  const priceable = kind ? kind.valuation.kind === "market_price" || kind.valuation.kind === "nav_unit_price" : true;

  return (
    <main>
      <p className="muted">
        <Link href="/assets">{c.backToList}</Link>
      </p>
      <h1>{c.edit({ identifier: asset.identifier })}</h1>
      <Notice searchParams={query} />
      <AssetForm
        action={updateAssetAction.bind(null, id)}
        kinds={kindOptions(PACKS)}
        values={{ ...asset, metadata: asset.metadata }}
        lockIdentity={locked}
        submitLabel={c.save}
        copy={{ ...copy.screens.assetForm, reasons: copy.reasons }}
      />

      <section id="position" aria-labelledby="position-h">
        <h2 id="position-h" className="section-label">
          {c.position.title}
        </h2>
        {oversold ? (
          <p role="alert">{copy.status.reasons.oversell}</p>
        ) : lots.length === 0 ? (
          <p className="muted">{c.position.none}</p>
        ) : (
          <>
            <p className="muted">{c.position.help}</p>
            <table className="stack">
              <thead>
                <tr>
                  <th>{c.position.columns.opened}</th>
                  <th className="num">{c.position.columns.quantity}</th>
                  <th className="num">{c.position.columns.unitPrice}</th>
                  <th className="num">{c.position.columns.cost}</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.transactionId}>
                    <td data-label={c.position.columns.opened} className="figure">
                      {formatDate(lot.openedOn, locale)}
                    </td>
                    <td data-label={c.position.columns.quantity} className="num">
                      <Amount
                        value={formatQuantity(toDecimalString(lot.quantity), locale)}
                        hiddenLabel={copy.nav.amountHidden}
                      />
                    </td>
                    <td data-label={c.position.columns.unitPrice} className="num">
                      <Amount
                        value={formatPrice(toDecimalString(lot.unitPrice), locale)}
                        hiddenLabel={copy.nav.amountHidden}
                      />
                    </td>
                    <td data-label={c.position.columns.cost} className="num">
                      <Amount
                        value={formatPrice(toDecimalString(lot.quantity.times(lot.unitPrice)), locale)}
                        hiddenLabel={copy.nav.amountHidden}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">
                    {c.position.totals} <span className="muted">({c.beforeFees})</span>
                  </th>
                  <td className="num">
                    <Amount
                      value={formatQuantity(toDecimalString(quantity), locale)}
                      hiddenLabel={copy.nav.amountHidden}
                    />
                  </td>
                  <td className="num">
                    {average === null ? null : (
                      <Amount
                        value={formatPrice(toDecimalString(average), locale)}
                        hiddenLabel={copy.nav.amountHidden}
                      />
                    )}
                  </td>
                  <td className="num">
                    {cost === null ? null : (
                      <Amount value={formatPrice(toDecimalString(cost), locale)} hiddenLabel={copy.nav.amountHidden} />
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </section>

      {priceable ? (
        <section id="prices" aria-labelledby="prices-h">
          <h2 id="prices-h" className="section-label">
            {c.prices}
          </h2>
          <p className="muted">{c.pricesHelp}</p>
          <form action={setManualPriceAction} className="row-form" aria-label={c.manualPrice}>
            <input type="hidden" name="asset_id" value={id} />
            <label>
              {c.priceDate}
              <input
                name="date"
                type="date"
                required
                aria-invalid={invalid.has("date") || undefined}
                className={invalid.has("date") ? "field-error" : undefined}
              />
            </label>
            <label>
              {c.price} ({asset.native_currency})
              <input
                name="price"
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]+)?"
                required
                aria-invalid={invalid.has("price") || undefined}
                className={invalid.has("price") ? "field-error" : undefined}
              />
            </label>
            <button type="submit">{c.setPrice}</button>
          </form>
          {manual.length > 0 ? (
            <ul className="plain-list">
              {manual.map((p) => (
                <li key={p.date}>
                  <span className="figure">{formatDate(p.date, locale)}</span> ·{" "}
                  <Amount value={formatPrice(p.price, locale)} hiddenLabel={copy.nav.amountHidden} />{" "}
                  <form action={deleteManualPriceAction} className="inline-form">
                    <input type="hidden" name="asset_id" value={id} />
                    <input type="hidden" name="date" value={p.date} />
                    <button type="submit" className="quiet">
                      {c.removePrice({ date: formatDate(p.date, locale) })}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
