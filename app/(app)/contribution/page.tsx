import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { contribution } from "@/lib/calc/contribution";
import { copyFor, type ReasonCode } from "@/lib/copy";
import { formatChange, formatDate, formatPercent } from "@/lib/format";
import { Amount } from "@/app/(app)/_components/amount";
import { PeriodNav } from "@/app/(app)/_components/period-nav";
import { Bars } from "@/app/(app)/_charts/bars";
import { contributionModel } from "@/app/(app)/_models/contribution";
import { readContributionWindow } from "./_read";
import styles from "./page.module.css";

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined);

/**
 * Contribution (SPEC §9 screen 4; US-011 AC-011.2): each holding's share of
 * the period's simple return through the kernel's contribution(), bars per
 * asset, a partial banner naming reasons, a drill-in per asset.
 */
export default async function ContributionPage({ searchParams }: PageProps<"/contribution">) {
  const { client } = await requireUser();
  const params = await searchParams;
  const w = await readContributionWindow(client, first(params.period));
  const copy = copyFor(w.read.settings.locale);
  const locale = w.read.settings.locale;
  const currency = w.read.settings.base_currency;
  const c = copy.screens.contribution;

  if (!w.period || !w.input) {
    return (
      <main>
        <h1>{c.title}</h1>
        <p className="muted">{copy.empty.contribution}</p>
      </main>
    );
  }
  const result = contribution({
    input: w.input,
    from: w.period.from,
    to: w.period.to,
    start: w.start,
    end: w.end,
    flows: w.flows,
  });
  const model = contributionModel({
    result,
    identifiers: Object.fromEntries(w.read.assets.map((a) => [a.id, a.identifier])),
    names: w.read.names,
    droppedFlows: w.dropped,
  });
  const total = model.total === null ? null : formatPercent(model.total, locale);
  const defined = model.rows.filter((r) => r.contribution !== null);

  return (
    <main>
      <h1>{c.title}</h1>
      <PeriodNav copy={copy} current={w.period.key} base="/contribution" query={{}} />
      <p className="muted">
        {copy.screens.performance.over({
          from: formatDate(w.period.from, locale),
          to: formatDate(w.period.to, locale),
        })}
      </p>
      <p className="muted">{c.help}</p>

      <dl className={styles.total}>
        <dt>{c.total}</dt>
        <dd className={`display ${total?.direction ?? ""}`}>{total ? total.text : "—"}</dd>
      </dl>
      {model.partial ? (
        <p role="status">
          {c.partial}{" "}
          {Object.entries(model.reasons).map(([reason, n]) => (
            <span key={reason}>{c.reason({ reason: copy.status.reasons[reason as ReasonCode] ?? reason, n })} </span>
          ))}
          {model.droppedFlows > 0 ? copy.screens.performance.droppedFlows({ n: model.droppedFlows }) : null}
        </p>
      ) : null}

      {defined.length === 0 ? (
        <p className="muted">{copy.empty.contribution}</p>
      ) : (
        <>
          <Bars
            points={defined.map((r) => ({
              key: r.assetId,
              label: r.identifier,
              value: r.contribution!,
              valueLabel: formatPercent(r.contribution!, locale).text,
            }))}
          />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{copy.nav.assets}</th>
                  <th className="num">{c.gain}</th>
                  <th className="num">{c.share}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {model.rows.map((r) => {
                  const gain = r.gain === null ? null : formatChange(r.gain, currency, locale);
                  const share = r.contribution === null ? null : formatPercent(r.contribution, locale);
                  return (
                    <tr key={r.assetId}>
                      <td>
                        <Link href={`/assets/${r.assetId}`}>{r.identifier}</Link>{" "}
                        <span className="muted">{r.name}</span>
                      </td>
                      <td className={`num ${gain?.direction ?? ""}`}>
                        {gain ? (
                          <Amount value={gain.text} hiddenLabel={copy.nav.amountHidden} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className={`num ${share?.direction ?? ""}`}>
                        {share ? (
                          share.text
                        ) : (
                          <span className="muted">
                            {r.reason ? (copy.status.reasons[r.reason as ReasonCode] ?? r.reason) : "—"}
                          </span>
                        )}
                      </td>
                      <td>
                        <Link href={`/contribution/${r.assetId}?period=${w.period.key}`}>{c.drillIn}</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
