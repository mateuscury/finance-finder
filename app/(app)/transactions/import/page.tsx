import Link from "next/link";
import { PACKS } from "@/packs";
import { AssetForm } from "@/app/(app)/assets/_form";
import { kindOptions } from "@/app/(app)/assets/_kinds";
import { createAssetThen } from "@/app/(app)/assets/actions";
import { Amount } from "@/app/(app)/_components/amount";
import { requireUser } from "@/lib/auth/session";
import { CANONICAL_COLUMNS, REQUIRED_COLUMNS } from "@/lib/import";
import { copyFor, type ImportOutcome } from "@/lib/copy";
import { formatPrice, formatQuantity } from "@/lib/format";
import { readSettings } from "@/lib/ledger/rows";
import { INSTANCE_DEFAULTS } from "@/lib/settings/defaults";
import { commitImportAction, discardImportAction, saveMappingAction, uploadCsvAction } from "./actions";
import { loadDryRun } from "./load";
import styles from "./page.module.css";

// The commit schedules the snapshot rebuild after the response (decision 30).
export const maxDuration = 60;

const EXAMPLE = "2024-03-14,buy,br,br.fii,HGLG11,100,162.40,BRL,2.50,";

type Step = "upload" | "map" | "preview" | "commit";

/** SPEC §9.1: upload → map columns → dry run → create unresolved assets inline → commit all or nothing. */
export default async function ImportPage({ searchParams }: PageProps<"/transactions/import">) {
  const { client } = await requireUser();
  const params = await searchParams;
  const [loaded, settings] = await Promise.all([loadDryRun(client, PACKS), readSettings(client)]);
  const copy = copyFor(settings.locale);
  const locale = settings.locale;
  const c = copy.screens.import;
  const error = typeof params.error === "string" ? params.error : null;
  const current: Step =
    loaded.kind !== "preview"
      ? "upload"
      : !loaded.run.ok
        ? "map"
        : loaded.run.counts.errors > 0 || loaded.run.counts.unresolved > 0
          ? "preview"
          : "commit";
  const steps: Step[] = ["upload", "map", "preview", "commit"];

  return (
    <main>
      <p className="muted">
        <Link href="/transactions">{c.back}</Link>
      </p>
      <h1>{c.title}</h1>
      <ol className="steps">
        {steps.map((s) => (
          <li key={s} aria-current={s === current ? "step" : undefined}>
            {c.steps[s]}
          </li>
        ))}
      </ol>
      {error ? <p role="alert">{copy.import[error as ImportOutcome] ?? copy.import.write_failed}</p> : null}
      {params.saved ? <p role="status">{loaded.kind === "preview" ? c.mappingSaved : copy.saved}</p> : null}

      {loaded.kind === "none" ? (
        <>
          <h2 className="section-label">{c.formatTitle}</h2>
          <p className="muted">{c.formatHelp}</p>
          <pre className={styles.format}>
            {CANONICAL_COLUMNS.join(",")}
            {"\n"}
            {EXAMPLE}
          </pre>
          <form action={uploadCsvAction} className="row-form">
            <label>
              {c.chooseFile}
              <input type="file" name="file" accept=".csv,text/csv" required />
            </label>
            <button type="submit" className="primary">
              {c.upload}
            </button>
          </form>
        </>
      ) : null}

      {loaded.kind === "unparsable" ? (
        <>
          <p role="alert">
            {c.unparsable({ filename: loaded.filename, reason: loaded.reason.replace(/_/g, " "), line: loaded.line })}
          </p>
          <form action={discardImportAction}>
            <button type="submit" className="quiet">
              {c.discard}
            </button>
          </form>
        </>
      ) : null}

      {loaded.kind === "preview" ? (
        <>
          <div className={styles.fileLine}>
            <span>{c.file({ filename: loaded.filename, rows: loaded.rowCount })}</span>
            <form action={discardImportAction} className="inline-form">
              <button type="submit" className="quiet">
                {c.discard}
              </button>
            </form>
          </div>

          <h2 className="section-label">{c.mapTitle}</h2>
          <p className="muted">{c.mapHelp}</p>
          <form action={saveMappingAction}>
            <div className={styles.mapGrid}>
              {CANONICAL_COLUMNS.map((col) => (
                <label key={col}>
                  <code>{col}</code>
                  {REQUIRED_COLUMNS.includes(col) ? <span className="muted"> ({c.required})</span> : null}
                  <select
                    name={`map_${col}`}
                    defaultValue={loaded.map[col] ?? loaded.header.find((h) => h.trim().toLowerCase() === col) ?? ""}
                  >
                    <option value="">{c.notInFile}</option>
                    {loaded.header.map((h, i) => (
                      <option key={`${h}-${i}`} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button type="submit">{c.saveMapping}</button>
          </form>

          {!loaded.run.ok ? (
            <p role="alert">{c.missingColumns({ columns: loaded.run.missing.join(", ") })}</p>
          ) : (
            <>
              <h2 className="section-label">{c.previewTitle}</h2>
              <p className="muted">{c.counts(loaded.run.counts)}</p>
              {loaded.run.unresolved.length > 0 ? (
                <>
                  <h3>{c.unresolvedTitle}</h3>
                  {loaded.run.unresolved.map((u) => (
                    <details key={`${u.pack_id}|${u.instrument_kind}|${u.identifier}`} className="panel" open>
                      <summary>
                        {c.unresolvedRows({
                          pack: u.pack_id,
                          kind: u.instrument_kind,
                          identifier: u.identifier,
                          rows: u.rows.map((r) => r + 1).join(", "),
                        })}
                      </summary>
                      {u.registered ? (
                        <AssetForm
                          action={createAssetThen.bind(null, "/transactions/import")}
                          kinds={kindOptions(PACKS)}
                          fixedKind
                          values={{
                            pack_id: u.pack_id,
                            instrument_kind: u.instrument_kind,
                            identifier: u.identifier,
                            name: u.identifier,
                            native_currency: INSTANCE_DEFAULTS.baseCurrency,
                          }}
                          submitLabel={c.createAsset}
                          copy={{ ...copy.screens.assetForm, reasons: copy.reasons }}
                        />
                      ) : (
                        <p role="alert">{c.unregisteredKind}</p>
                      )}
                    </details>
                  ))}
                </>
              ) : null}
              <form action={commitImportAction}>
                <input type="hidden" name="preview_hash" value={loaded.run.previewHash} />
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{c.columns.row}</th>
                        <th>{c.columns.date}</th>
                        <th>{c.columns.type}</th>
                        <th>{c.columns.identifier}</th>
                        <th className="num">{c.columns.quantity}</th>
                        <th className="num">{c.columns.unitPrice}</th>
                        <th className="num">{c.columns.fees}</th>
                        <th>{c.columns.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loaded.run.rows.map((r) => {
                        const bad = r.errors.length > 0;
                        return (
                          <tr key={r.index} className={bad ? styles.badRow : r.duplicate ? styles.dupRow : undefined}>
                            <td className="figure">{r.index + 1}</td>
                            <td className="figure">{r.values.date}</td>
                            <td>{r.values.type}</td>
                            <td>{r.values.identifier}</td>
                            <td className="num">
                              {r.parsed ? (
                                <Amount
                                  value={formatQuantity(r.parsed.quantity, locale)}
                                  hiddenLabel={copy.nav.amountHidden}
                                />
                              ) : (
                                r.values.quantity
                              )}
                            </td>
                            <td className="num">
                              {r.parsed ? (
                                <Amount
                                  value={formatPrice(r.parsed.unit_price, locale)}
                                  hiddenLabel={copy.nav.amountHidden}
                                />
                              ) : (
                                r.values.unit_price
                              )}{" "}
                              {r.values.currency}
                            </td>
                            <td className="num">
                              {r.parsed ? (
                                <Amount
                                  value={formatPrice(r.parsed.fees, locale)}
                                  hiddenLabel={copy.nav.amountHidden}
                                />
                              ) : (
                                r.values.fees
                              )}
                            </td>
                            <td>
                              {r.oversell ? (
                                // Naming the rule beats naming the column: the
                                // quantity is well-formed, the ledger is not.
                                <span className="neg">⚠ {copy.status.reasons.oversell}</span>
                              ) : bad ? (
                                <span className="neg">⚠ {c.status.error({ fields: r.errors.join(", ") })}</span>
                              ) : r.assetId === null ? (
                                <span className="muted">— {c.status.unresolved}</span>
                              ) : r.duplicate ? (
                                <label className={styles.dup}>
                                  ↻ {c.status.duplicate} — <input type="checkbox" name="force" value={r.index} />{" "}
                                  {c.status.include}
                                </label>
                              ) : (
                                <span className="pos">✓ {c.status.ready}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="muted">{c.commitHelp}</p>
                <button
                  type="submit"
                  className="primary"
                  disabled={loaded.run.counts.errors > 0 || loaded.run.counts.unresolved > 0}
                >
                  {c.commit({ n: loaded.run.counts.valid - loaded.run.counts.duplicates })}
                </button>
              </form>
            </>
          )}
        </>
      ) : null}
    </main>
  );
}
