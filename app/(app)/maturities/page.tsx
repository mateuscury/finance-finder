import Link from "next/link";
import { PACKS } from "@/packs";
import { requireUser } from "@/lib/auth/session";
import { valuePortfolio } from "@/lib/calc/portfolio";
import { todayIso } from "@/lib/clock";
import { copyFor, type ReasonCode } from "@/lib/copy";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";
import { readLedger, toPortfolioInput } from "@/lib/ledger/rows";
import { Amount } from "@/app/(app)/_components/amount";
import { ValueStatus } from "@/app/(app)/_components/value-status";
import { maturitiesModel, type MaturityRow } from "@/app/(app)/_models/maturities";
import styles from "./page.module.css";

/**
 * Maturities (SPEC §9 screen 5; US-012; decision 38): the ladder of every
 * holding whose kind declares a maturity, today's value with its mark, the
 * contracted value at maturity for plain-rate accruals only, and a matured
 * mark where the ledger still holds a bond past its date.
 */
export default async function MaturitiesPage() {
  const { client } = await requireUser();
  const today = todayIso();
  const read = await readLedger(client, PACKS, { prices: "latest" });
  const copy = copyFor(read.settings.locale);
  const locale = read.settings.locale;
  const currency = read.settings.base_currency;
  const c = copy.screens.maturities;
  const input = toPortfolioInput(read);
  const valuation = read.assets.length > 0 ? valuePortfolio(input, today) : null;
  const model = maturitiesModel({ read, input, today, valuation });

  const current = (r: MaturityRow) => {
    if (r.current.kind === "row") {
      const h = r.current.row;
      return (
        <>
          <Amount
            value={formatMoney(h.marketValueBase.toString(), currency, locale)}
            hiddenLabel={copy.nav.amountHidden}
          />{" "}
          <ValueStatus copy={copy} status={h.status} date={formatDate(h.priceDate, locale)} />
        </>
      );
    }
    if (r.current.kind === "excluded") {
      const e = r.current.entry;
      return e.status === "stale" ? (
        <>
          <Amount
            value={formatMoney(e.lastKnownBase.toString(), currency, locale)}
            hiddenLabel={copy.nav.amountHidden}
          />{" "}
          <ValueStatus copy={copy} status="stale" date={formatDate(e.priceDate, locale)} />
        </>
      ) : (
        <ValueStatus copy={copy} status="unpriced" reason={copy.status.reasons[e.reason as ReasonCode] ?? e.reason} />
      );
    }
    return <span className="muted">{c.noValueToday}</span>;
  };
  const atMaturity = (r: MaturityRow) =>
    r.contracted !== null ? (
      <Amount value={`${formatMoney(r.contracted, r.nativeCurrency, locale)}`} hiddenLabel={copy.nav.amountHidden} />
    ) : (
      <span className="muted">{r.indexed ? c.dependsOnIndex : c.navNoProjection}</span>
    );

  return (
    <main>
      <h1>{c.title}</h1>
      {model.empty ? (
        <p className="muted">
          {copy.empty.maturities} <Link href="/assets">{copy.nav.assets}</Link>
        </p>
      ) : (
        <>
          <p className="muted">{c.help}</p>
          <p className="muted">{c.asOf({ date: formatDate(today, locale) })}</p>

          <h2 className={styles.label}>{c.ladder}</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{c.maturity}</th>
                  <th>{copy.nav.assets}</th>
                  <th className="num">{c.current}</th>
                  <th className="num">{c.atMaturity}</th>
                </tr>
              </thead>
              <tbody>
                {model.rows.map((r) => (
                  <tr key={r.assetId} className={r.matured ? styles.matured : undefined}>
                    <td>
                      <span className="figure">{formatDate(r.maturity, locale)}</span>{" "}
                      <span className="muted">{c.daysToGo({ n: r.daysToGo })}</span>
                      {r.matured ? (
                        <div className={styles.maturedNote} role="status">
                          ⚠ {c.matured} <Link href={`/transactions?asset=${r.assetId}`}>{c.recordRedemption}</Link>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Link href={`/assets/${r.assetId}`}>{r.identifier}</Link> <span className="muted">{r.name}</span>
                      <div className="muted">{r.kindLabel}</div>
                    </td>
                    <td className="num">{current(r)}</td>
                    <td className="num">{atMaturity(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className={styles.label}>{c.timeline}</h2>
          <ol className={styles.timeline}>
            {model.timeline.map((t) => (
              <li key={t.month}>
                <span className={styles.month}>{formatMonth(t.month, locale)}</span>
                <ul>
                  {t.rows.map((r) => (
                    <li key={r.assetId} className={r.matured ? styles.matured : undefined}>
                      <span className="figure">{formatDate(r.maturity, locale)}</span> ·{" "}
                      <Link href={`/assets/${r.assetId}`}>{r.identifier}</Link>{" "}
                      {r.contracted !== null ? (
                        <Amount
                          value={formatMoney(r.contracted, r.nativeCurrency, locale)}
                          hiddenLabel={copy.nav.amountHidden}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}
