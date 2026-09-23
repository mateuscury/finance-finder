import Link from "next/link";
import { PACKS } from "@/packs";
import { requireUser } from "@/lib/auth/session";
import { todayIso } from "@/lib/clock";
import { copyFor } from "@/lib/copy";
import { formatDate, formatMoney, formatShare } from "@/lib/format";
import { countLedger } from "@/lib/ledger/queries";
import { readLedger, toPortfolioInput } from "@/lib/ledger/rows";
import { readSnapshotRowsAt, readSnapshotTotals } from "@/lib/ledger/snapshots";
import { readStatus } from "@/lib/ledger/status";
import { addDays } from "@/lib/calc/dates";
import { Amount } from "./_components/amount";
import { Change } from "./_components/change";
import { Donut } from "./_charts/donut";
import { Sparkline } from "./_charts/sparkline";
import { valueLedger } from "./_lib/valuation";
import { overviewModel, type FirstRunStep } from "./_models/overview";
import styles from "./page.module.css";

const SPARKLINE_DAYS = 90;

/**
 * Overview (SPEC §9 screen 1; §9.3 first-run card; §9.5 empty states).
 * Today's headline is the kernel over a latest-price read; everything
 * over time comes from the snapshots (decision 36).
 */
export default async function OverviewPage() {
  const { client } = await requireUser();
  const today = todayIso();
  const [counts, read, totals] = await Promise.all([
    countLedger(client),
    readLedger(client, PACKS, { prices: "latest" }),
    readSnapshotTotals(client, { from: addDays(today, -SPARKLINE_DAYS) }),
  ]);
  const copy = copyFor(read.settings.locale);
  const locale = read.settings.locale;
  const currency = read.settings.base_currency;
  const status = await readStatus(client, PACKS, process.env, today);
  const lastDate = totals.at(-1)?.date ?? null;
  const prevDate = totals.at(-2)?.date ?? null;
  const [latestRows, previousRows] = await Promise.all([
    lastDate ? readSnapshotRowsAt(client, lastDate) : Promise.resolve([]),
    prevDate ? readSnapshotRowsAt(client, prevDate) : Promise.resolve([]),
  ]);
  const { valuation, oversold } = valueLedger(toPortfolioInput(read), today);
  const model = overviewModel({
    counts,
    settings: read.settings,
    valuation,
    unpricedAssets: status.unpricedAssets,
    totals,
    latestRows,
    previousRows,
    assets: read.assets,
    names: read.names,
  });

  const stepCopy: Record<FirstRunStep, { text: string; href: string }> = {
    base_currency: { text: copy.firstRun.baseCurrency({ currency }), href: "/settings" },
    first_asset: { text: copy.firstRun.firstAsset, href: "/assets" },
    first_transaction: { text: copy.firstRun.firstTransaction, href: "/transactions" },
    priced: {
      text:
        status.unpricedAssets > 0 ? copy.firstRun.pricedPending({ n: status.unpricedAssets }) : copy.firstRun.priced,
      href: "/assets",
    },
  };
  const change = (c: NonNullable<typeof model.dayChange>) => (
    <Change delta={c.delta} rate={c.rate} currency={currency} locale={locale} copy={copy} className={styles.change} />
  );

  return (
    <main>
      <h1>{copy.screens.overview.title}</h1>
      {oversold.length > 0 ? <p role="alert">{copy.errors.ledger({ n: oversold.length })}</p> : null}

      {model.firstRun ? (
        <section className={styles.card} aria-labelledby="first-run">
          <h2 id="first-run">{copy.firstRun.title}</h2>
          <ol className={styles.steps}>
            {model.firstRun.steps.map((s, i) => (
              <li key={s.key} className={s.done ? styles.done : undefined}>
                <span className={styles.stepNo} aria-hidden="true">
                  {s.done ? "✓" : i + 1}
                </span>
                {s.done ? (
                  <span>
                    <s>{stepCopy[s.key].text}</s> <span className="muted">{copy.firstRun.done}</span>
                  </span>
                ) : (
                  <Link href={stepCopy[s.key].href}>{stepCopy[s.key].text}</Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className={styles.headline} aria-labelledby="headline">
        <h2 id="headline" className={styles.label}>
          {copy.screens.overview.headline}
        </h2>
        {model.headline.kind === "total" ? (
          <>
            <p className="display">
              <Amount
                value={formatMoney(model.headline.total, model.headline.currency, locale)}
                hiddenLabel={copy.nav.amountHidden}
              />
            </p>
            <p className="muted">
              {model.headline.staleCount > 0
                ? copy.screens.overview.staleExcluded({ n: model.headline.staleCount })
                : null}
              {model.headline.staleCount > 0 && model.headline.carriedCount > 0 ? " · " : null}
              {model.headline.carriedCount > 0
                ? copy.screens.overview.carried({ n: model.headline.carriedCount })
                : null}
            </p>
          </>
        ) : (
          <p className="display muted">
            —{" "}
            <small>
              {model.headline.unpriced > 0 ? (
                <Link href="/assets">{copy.empty.overviewHeadline({ n: model.headline.unpriced })}</Link>
              ) : null}
            </small>
          </p>
        )}
        <dl className={styles.changes}>
          <dt>{copy.screens.overview.dayChange}</dt>
          <dd>
            {model.dayChange ? change(model.dayChange) : <span className="muted">{copy.empty.overviewHistory}</span>}
          </dd>
          {model.periodChange ? (
            <>
              <dt>
                {copy.screens.overview.periodChange({
                  from: formatDate(model.periodChange.from, locale),
                  to: formatDate(model.periodChange.to, locale),
                })}
              </dt>
              <dd>{change(model.periodChange)}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <div className={styles.grid}>
        <section aria-labelledby="history">
          <h2 id="history" className={styles.label}>
            {copy.screens.overview.history}
          </h2>
          {model.sparkline.length >= 2 ? (
            <Sparkline
              points={model.sparkline.map((p) => ({
                x: formatDate(p.date, locale),
                y: p.total,
                label: formatMoney(p.total, currency, locale),
                stale: p.stale,
              }))}
            />
          ) : (
            <p className="muted">{copy.empty.overviewHistory}</p>
          )}
        </section>

        <section aria-labelledby="allocation">
          <h2 id="allocation" className={styles.label}>
            {copy.screens.overview.allocation}
          </h2>
          {model.allocation.length > 0 ? (
            <Donut
              slices={model.allocation.map((a) => ({
                key: a.kindId,
                label: a.kindLabel,
                value: a.valueBase,
                shareLabel: formatShare(a.share, locale),
                valueLabel: formatMoney(a.valueBase, currency, locale),
              }))}
            />
          ) : (
            <p className="muted">
              {copy.empty.allocation} <Link href="/assets">{copy.nav.assets}</Link>
            </p>
          )}
        </section>

        <section aria-labelledby="movers">
          <h2 id="movers" className={styles.label}>
            {copy.screens.overview.movers}
          </h2>
          {model.movers.length > 0 ? (
            <table>
              <tbody>
                {model.movers.map((m) => (
                  <tr key={m.assetId}>
                    <td>
                      <Link href={`/assets/${m.assetId}`}>{m.identifier}</Link> <span className="muted">{m.name}</span>
                    </td>
                    <td className="num">{change({ delta: m.delta, rate: m.rate, from: "", to: "" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">{copy.empty.overviewHistory}</p>
          )}
        </section>
      </div>
    </main>
  );
}
