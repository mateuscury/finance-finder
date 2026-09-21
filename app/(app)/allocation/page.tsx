import Link from "next/link";
import { PACKS } from "@/packs";
import { requireUser } from "@/lib/auth/session";
import { copyFor } from "@/lib/copy";
import { formatDate, formatDecimal, formatMoney, formatShare } from "@/lib/format";
import { readLedger } from "@/lib/ledger/rows";
import { readSnapshotRange, readSnapshotRowsAt } from "@/lib/ledger/snapshots";
import { Amount } from "@/app/(app)/_components/amount";
import { ValueStatus } from "@/app/(app)/_components/value-status";
import { Donut } from "@/app/(app)/_charts/donut";
import { allocationModel, type AllocationSlice } from "@/app/(app)/_models/allocation";
import styles from "./page.module.css";

/**
 * Allocation (SPEC §9 screen 3; US-011 AC-011.1): by kind, by market, by
 * currency and native-vs-base exposure, from the latest snapshot's rows.
 * Every share adds to exactly 100.00; a stale row is shown, not allocated.
 */
export default async function AllocationPage() {
  const { client } = await requireUser();
  const [range, read] = await Promise.all([
    readSnapshotRange(client),
    readLedger(client, PACKS, { prices: "latest", seriesFrom: "9999-12-31" }),
  ]);
  const copy = copyFor(read.settings.locale);
  const locale = read.settings.locale;
  const c = copy.screens.allocation;
  const rows = range.last ? await readSnapshotRowsAt(client, range.last) : [];
  const model = allocationModel({ rows, assets: read.assets, names: read.names });
  const currency = model.baseCurrency ?? read.settings.base_currency;

  const donut = (slicesOf: AllocationSlice[]) => (
    <Donut
      slices={slicesOf.map((s) => ({
        key: s.key,
        label: s.label,
        value: s.valueBase,
        shareLabel: formatShare(s.share, locale),
        valueLabel: formatMoney(s.valueBase, currency, locale),
      }))}
    />
  );

  return (
    <main>
      <h1>{c.title}</h1>
      {model.empty ? (
        <p className="muted">
          {copy.empty.allocation} <Link href="/assets">{copy.nav.assets}</Link>
        </p>
      ) : (
        <>
          <p className="muted">{c.asOf({ date: formatDate(model.date!, locale) })}</p>
          {model.unresolved > 0 ? <p role="status">{c.unresolved({ n: model.unresolved })}</p> : null}
          <div className={styles.grid}>
            <section aria-labelledby="by-kind">
              <h2 id="by-kind" className={styles.label}>
                {c.byKind}
              </h2>
              {donut(model.byKind)}
            </section>
            <section aria-labelledby="by-pack">
              <h2 id="by-pack" className={styles.label}>
                {c.byPack}
              </h2>
              {donut(model.byPack)}
            </section>
            <section aria-labelledby="by-currency">
              <h2 id="by-currency" className={styles.label}>
                {c.byCurrency}
              </h2>
              {donut(model.byCurrency)}
            </section>
          </div>

          <section aria-labelledby="exposure">
            <h2 id="exposure" className={styles.label}>
              {c.exposure}
            </h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{c.currency}</th>
                    <th className="num">{c.native}</th>
                    <th className="num">{c.base}</th>
                  </tr>
                </thead>
                <tbody>
                  {model.exposure.map((e) => (
                    <tr key={e.currency}>
                      <td>{e.currency}</td>
                      <td className="num">
                        <Amount
                          value={`${formatDecimal(e.native, locale, { minFraction: 2, maxFraction: 2 })} ${e.currency}`}
                          hiddenLabel={copy.nav.amountHidden}
                        />
                      </td>
                      <td className="num">
                        <Amount value={formatMoney(e.base, currency, locale)} hiddenLabel={copy.nav.amountHidden} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {model.stale.length > 0 ? (
            <section aria-labelledby="stale">
              <h2 id="stale" className={styles.label}>
                {c.stale}
              </h2>
              <ul className={styles.stale}>
                {model.stale.map((s) => (
                  <li key={s.assetId}>
                    <Link href={`/assets/${s.assetId}`}>{s.identifier}</Link> <span className="muted">{s.name}</span>{" "}
                    <Amount
                      value={formatMoney(s.lastKnownBase, currency, locale)}
                      hiddenLabel={copy.nav.amountHidden}
                    />{" "}
                    <ValueStatus
                      copy={copy}
                      status="stale"
                      date={s.priceDate ? formatDate(s.priceDate, locale) : null}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
