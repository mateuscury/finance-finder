import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { attribution } from "@/lib/calc/attribution";
import { copyFor, type ReasonCode } from "@/lib/copy";
import { formatDate, formatPercent } from "@/lib/format";
import { attributionModel } from "@/app/(app)/_models/contribution";
import { readContributionWindow } from "../_read";
import styles from "../page.module.css";

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined);

/**
 * The drill-in (SPEC §9 screen 4, §6; US-011 AC-011.3): one holding's
 * return split into its native and FX legs by the kernel's attribution(),
 * the identity stated; a base-currency asset shows R_fx = 0 as a fact and
 * the §11 gap is stated once, with no currency named.
 */
export default async function AttributionPage({ params, searchParams }: PageProps<"/contribution/[assetId]">) {
  const { client } = await requireUser();
  const { assetId } = await params;
  const query = await searchParams;
  const w = await readContributionWindow(client, first(query.period));
  const copy = copyFor(w.read.settings.locale);
  const locale = w.read.settings.locale;
  const c = copy.screens.contribution;
  const asset = w.read.assets.find((a) => a.id === assetId);
  if (!asset) notFound();

  const back = (
    <p className="muted">
      <Link href={w.period ? `/contribution?period=${w.period.key}` : "/contribution"}>{c.back}</Link>
    </p>
  );
  if (!w.period || !w.input || !w.start || !w.end) {
    return (
      <main>
        <h1>
          {c.attribution} · {asset.identifier}
        </h1>
        {w.oversold.length > 0 ? (
          <p role="alert">{copy.errors.ledger({ n: w.oversold.length })}</p>
        ) : (
          <p className="muted">{copy.empty.contribution}</p>
        )}
        {back}
      </main>
    );
  }
  const m = attributionModel(attribution(w.input, assetId, w.period.from, w.period.to));
  const leg = (v: string | null) => {
    if (v === null) return <span className="muted">—</span>;
    const p = formatPercent(v, locale);
    return <span className={`figure ${p.direction}`}>{p.text}</span>;
  };

  return (
    <main>
      <h1>
        {c.attribution} · {asset.identifier} <span className="muted">{w.read.names[assetId]}</span>
      </h1>
      <p className="muted">
        {copy.screens.performance.over({
          from: formatDate(w.period.from, locale),
          to: formatDate(w.period.to, locale),
        })}
      </p>
      <p className="muted">{c.attributionHelp}</p>
      {m.reason === "no_position" ? (
        <p role="status">{c.noPosition}</p>
      ) : m.reason ? (
        <p role="status">{copy.status.reasons[m.reason as ReasonCode] ?? m.reason}</p>
      ) : null}
      <dl className={styles.legs}>
        <dt>{c.rNative}</dt>
        <dd className="display">{leg(m.rNative)}</dd>
        <dt>{c.rFx}</dt>
        <dd className="display">{leg(m.rFx)}</dd>
        <dt>{c.rBase}</dt>
        <dd className="display">{leg(m.rBase)}</dd>
      </dl>
      <p className="muted figure">{c.identity}</p>
      {m.isBaseCurrency ? <p>{c.baseCurrencyNote}</p> : null}
      <p className="muted">{c.bdrGap}</p>
      {m.boundaries.length > 1 ? <p className="muted">{c.chained({ n: m.boundaries.length - 1 })}</p> : null}
      {back}
    </main>
  );
}
