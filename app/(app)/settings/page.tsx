import Link from "next/link";
import { PACKS } from "@/packs";
import { Notice } from "@/app/(app)/_components/notice";
import { fieldsFrom } from "@/app/(app)/_lib/form";
import { requireUser } from "@/lib/auth/session";
import { Fragment } from "react";
import { copyFor, LOCALES, type DeleteOutcome, type ReasonCode, type RestoreOutcome } from "@/lib/copy";
import { formatDate } from "@/lib/format";
import { readSettings } from "@/lib/ledger/rows";
import { countLedger } from "@/lib/ledger/queries";
import { readStatus } from "@/lib/ledger/status";
import { resolveActivation } from "@/lib/packs/activate";
import { todayIso } from "@/lib/clock";
import {
  changeBaseCurrencyAction,
  changePasswordAction,
  deleteEverythingAction,
  restoreBackupAction,
  setEnabledPacksAction,
  signOutEverywhereAction,
  unenrolTotpAction,
  updatePreferencesAction,
} from "./actions";
import type { SecurityReason } from "@/lib/auth/security";
import { TotpEnrol } from "./totp-enrol";
import styles from "./page.module.css";

// Pack enable schedules a series backfill after the response (decision 30).
export const maxDuration = 60;

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

/**
 * Settings (SPEC §9 screen 9) in its three sections: Portfolio (base
 * currency, packs, appearance and language), Security (§9.6) and Your data
 * (§12.1, §12.3). Every form is server-rendered on the redirect-to-<Notice>
 * pattern; the one client widget is TOTP enrolment.
 */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { client, identity } = await requireUser();
  const params = await searchParams;
  const settings = await readSettings(client);
  const today = todayIso();
  const [status, counts, seriesCount] = await Promise.all([
    readStatus(client, PACKS, process.env, today),
    countLedger(client),
    // Shared market data, not this user's: an estimate is the honest figure
    // and an exact count over years of points is not worth the scan.
    client
      .from("series_points")
      .select("*", { count: "estimated", head: true })
      .then((r) => r.count ?? 0),
  ]);
  const activePacks = resolveActivation(PACKS, [...new Set(settings.enabled_packs ?? [])]).packs;
  const disabledBy = new Map(status.disabledSources.map((d) => [d.sourceId, d.variable]));
  const failingBy = new Map(status.failingSources.map((f) => [f.sourceId, f.code]));
  const copy = copyFor(settings.locale);
  const s = copy.screens.settings;
  const factors = await client.auth.mfa.listFactors();
  const enrolled = (factors.data?.totp ?? []).length > 0;
  const enabled = new Set(settings.enabled_packs ?? []);
  const invalid = fieldsFrom(params);
  const security = first(params.security);
  const restore = first(params.restore);
  const del = first(params.delete);
  const recovery = <code>pnpm bootstrap:user --reset-mfa</code>;

  return (
    <main>
      <h1>{s.title}</h1>
      <Notice searchParams={params} />
      {security ? (
        <p role="alert">{copy.security[security as SecurityReason | "factor_exists"] ?? copy.security.auth_failed}</p>
      ) : null}

      <section aria-labelledby="portfolio-h" className={styles.section}>
        <h2 id="portfolio-h" className="section-label">
          {s.portfolio.title}
        </h2>
        <form action={changeBaseCurrencyAction} className={styles.form}>
          <label>
            {s.portfolio.baseCurrency}
            <input
              name="base_currency"
              defaultValue={settings.base_currency}
              pattern="[A-Z]{3}"
              required
              className={`${styles.short} ${invalid.has("base_currency") ? "field-error" : ""}`}
              aria-invalid={invalid.has("base_currency") || undefined}
              aria-describedby="base-currency-help"
            />
          </label>
          <p id="base-currency-help" className="muted">
            <small>{s.portfolio.baseCurrencyHelp}</small>
          </p>
          <label className={styles.check}>
            <input type="checkbox" name="confirm_reset" /> <span>{s.portfolio.confirmReset}</span>
          </label>
          <button type="submit">{s.portfolio.saveBaseCurrency}</button>
        </form>

        <form action={setEnabledPacksAction} className={styles.form}>
          <fieldset>
            <legend>{s.portfolio.packs}</legend>
            <p className="muted">
              <small>{s.portfolio.packsHelp}</small>
            </p>
            <ul className="plain-list">
              {PACKS.map((p) => (
                <li key={p.id}>
                  <label className={styles.pack}>
                    <input
                      type="checkbox"
                      name="packs"
                      value={p.id}
                      defaultChecked={enabled.has(p.id)}
                      disabled={p.status === "unmaintained"}
                    />
                    <span>
                      <strong>{p.name}</strong> <span className="muted">{p.id}</span>{" "}
                      <span className={`${styles.badge} ${p.status === "draft" ? styles.badgeDraft : ""}`}>
                        {copy.screens.assetForm.packStatus[p.status]}
                      </span>
                      <br />
                      <small className="muted">
                        {s.portfolio.packCounts({ instruments: p.instruments.length, series: p.series.length })}
                        {p.status === "draft" ? ` · ${s.portfolio.draftNote}` : ""}
                        {p.status === "unmaintained" ? ` · ${s.portfolio.unmaintainedNote}` : ""}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <button type="submit">{s.portfolio.savePacks}</button>
        </form>

        <form action={updatePreferencesAction} className={styles.form} aria-label={s.portfolio.preferences}>
          <div className={styles.row}>
            <label>
              {s.portfolio.theme}
              <select name="theme" defaultValue={settings.theme}>
                <option value="system">{copy.nav.themeSystem}</option>
                <option value="light">{copy.nav.themeLight}</option>
                <option value="dark">{copy.nav.themeDark}</option>
              </select>
            </label>
            <label>
              {s.portfolio.language}
              <select name="locale" defaultValue={settings.locale}>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {copyFor(l).languageName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit">{s.portfolio.savePreferences}</button>
        </form>
      </section>

      <section aria-labelledby="security-h" className={styles.section}>
        <h2 id="security-h" className="section-label">
          {s.security.title}
        </h2>
        <p>
          {s.security.signedInAs({
            who: identity.email ?? identity.userId,
            level: s.security.levels[identity.currentLevel],
          })}
        </p>

        <form action={changePasswordAction} className={styles.form} aria-label={s.security.password}>
          <div className={styles.row}>
            <label>
              {s.security.newPassword}
              <input name="password" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <label>
              {s.security.confirmPassword}
              <input name="confirm" type="password" autoComplete="new-password" minLength={12} required />
            </label>
          </div>
          <p className="muted">
            <small>{s.security.passwordRule}</small>
          </p>
          <button type="submit">{s.security.changePassword}</button>
        </form>

        <h3>{s.security.secondFactor}</h3>
        {enrolled ? (
          <>
            <p>{s.security.enrolled}</p>
            <form action={unenrolTotpAction} className={styles.form}>
              <button type="submit">{s.security.removeFactor}</button>
            </form>
            <p className="muted">
              <small>
                {s.security.recoveryBefore}
                {recovery}
                {s.security.recoveryAfter}
              </small>
            </p>
          </>
        ) : (
          <>
            <p>{s.security.notEnrolled}</p>
            <TotpEnrol copy={s.security.enrol} reasons={copy.security} />
          </>
        )}

        <h3>{s.security.sessions}</h3>
        <form action={signOutEverywhereAction} className={styles.form}>
          <button type="submit">{s.security.signOutEverywhere}</button>
        </form>
      </section>

      <section id="instance" aria-labelledby="instance-h" className={styles.section}>
        <h2 id="instance-h" className="section-label">
          {s.data.instance.title}
        </h2>
        <p className="muted">{s.data.instance.help}</p>
        <dl className={styles.instance}>
          <dt>{s.data.instance.lastPriceRun}</dt>
          <dd className={status.ingestStale ? "neg" : undefined}>
            {status.lastIngestRunAt
              ? formatDate(status.lastIngestRunAt.slice(0, 10), settings.locale)
              : s.data.instance.never}
          </dd>
          {activePacks
            .flatMap((p) => p.sources)
            .map((source) => (
              <Fragment key={source.id}>
                <dt>
                  <code>{source.id}</code>
                </dt>
                <dd>
                  {disabledBy.has(source.id) ? (
                    s.data.instance.sourceDisabled({ variable: disabledBy.get(source.id) as string })
                  ) : failingBy.has(source.id) ? (
                    <span className="neg">
                      {copy.status.reasons[failingBy.get(source.id) as ReasonCode] ?? failingBy.get(source.id)}
                    </span>
                  ) : (
                    <span className="muted">{s.data.instance.sourceOk}</span>
                  )}
                </dd>
              </Fragment>
            ))}
          <dt>{s.data.instance.snapshotsThrough}</dt>
          <dd className={status.rebuild?.stalled ? "neg" : undefined}>
            {status.snapshotsThrough ? formatDate(status.snapshotsThrough, settings.locale) : s.data.instance.never}
            {status.snapshotsWrittenAt ? (
              <>
                {" "}
                <span className="muted">
                  {s.data.instance.writtenAt({
                    at: formatDate(status.snapshotsWrittenAt.slice(0, 10), settings.locale),
                  })}
                </span>
              </>
            ) : null}
          </dd>
        </dl>

        <h3>{s.data.instance.storage}</h3>
        <dl className={styles.instance}>
          <dt>{s.data.instance.rows.assets}</dt>
          <dd className="figure">{counts.assets}</dd>
          <dt>{s.data.instance.rows.transactions}</dt>
          <dd className="figure">{counts.transactions}</dd>
          <dt>{s.data.instance.rows.cashFlows}</dt>
          <dd className="figure">{counts.cashFlows}</dd>
          <dt>{s.data.instance.rows.prices}</dt>
          <dd className="figure">{counts.prices}</dd>
          <dt>{s.data.instance.rows.snapshots}</dt>
          <dd className="figure">{counts.snapshots}</dd>
          <dt>{s.data.instance.rows.series}</dt>
          <dd className="figure">
            ~{seriesCount} <span className="muted">{s.data.instance.seriesNote}</span>
          </dd>
        </dl>
        <p className="muted">{s.data.instance.growth}</p>
      </section>

      <section aria-labelledby="data-h" className={styles.section}>
        <h2 id="data-h" className="section-label">
          {s.data.title}
        </h2>
        <p>{s.data.disclosure}</p>
        <p>
          {s.data.lastExport({
            date: settings.last_export_at ? formatDate(settings.last_export_at.slice(0, 10), settings.locale) : null,
          })}{" "}
          <span className="muted">{s.data.noBackups}</span>
        </p>
        <div className={styles.downloads}>
          <Link href="/settings/export/json">{s.data.downloadJson}</Link>
          <Link href="/settings/export/csv">{s.data.downloadCsv}</Link>
        </div>

        <h3>{s.data.restoreTitle}</h3>
        <p className="muted">
          <small>{s.data.restoreHelp}</small>
        </p>
        {restore ? (
          <p role={restore === "done" ? "status" : "alert"}>
            {restore === "warnings"
              ? copy.restore.warnings({ count: parseInt(String(params.count), 10) || 0, codes: String(params.codes) })
              : (copy.restore[restore as RestoreOutcome] ?? copy.restore.write_failed)}
          </p>
        ) : null}
        <form action={restoreBackupAction} className={styles.form}>
          <label>
            {s.data.restoreFile}
            <input type="file" name="file" accept=".json,application/json" required />
          </label>
          <label className={styles.check}>
            <input type="checkbox" name="acknowledge_warnings" /> <span>{s.data.acknowledge}</span>
          </label>
          <button type="submit">{s.data.restoreButton}</button>
        </form>

        <h3>{s.data.deleteTitle}</h3>
        {del ? <p role="alert">{copy.delete[del as DeleteOutcome] ?? copy.delete.failed}</p> : null}
        <form action={deleteEverythingAction} className={styles.danger}>
          <p>
            {s.data.deleteBefore}
            <code>delete everything</code>
            {s.data.deleteAfter}
          </p>
          <div className={styles.row}>
            <label>
              {s.data.phrase}
              <input name="phrase" autoComplete="off" required />
            </label>
            <label>
              {s.data.password}
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
          </div>
          <button type="submit">{s.data.deleteButton}</button>
        </form>
      </section>
    </main>
  );
}
