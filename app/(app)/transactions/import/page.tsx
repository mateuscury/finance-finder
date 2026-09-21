import Link from "next/link";
import { PACKS } from "@/packs";
import { AssetForm } from "@/app/(app)/assets/_form";
import { createAssetThen } from "@/app/(app)/assets/actions";
import { requireUser } from "@/lib/auth/session";
import { CANONICAL_COLUMNS, REQUIRED_COLUMNS } from "@/lib/import";
import { currentCopy, type ImportOutcome } from "@/lib/copy/server";
import { INSTANCE_DEFAULTS } from "@/lib/settings/defaults";
import { commitImportAction, discardImportAction, saveMappingAction, uploadCsvAction } from "./actions";
import { loadDryRun } from "./load";

// The commit schedules the snapshot rebuild after the response (decision 30).
export const maxDuration = 60;

/** SPEC §9.1: upload → map columns → dry run → create unresolved assets inline → commit all or nothing. */
export default async function ImportPage({ searchParams }: PageProps<"/transactions/import">) {
  const { client } = await requireUser();
  const copy = await currentCopy();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const loaded = await loadDryRun(client, PACKS);
  return (
    <main>
      <h1>Import transactions from CSV</h1>
      <p>
        <Link href="/transactions">Back to transactions</Link>
      </p>
      {error ? <p role="alert">{copy.import[error as ImportOutcome] ?? copy.import.write_failed}</p> : null}
      {params.saved ? <p role="status">Column mapping saved.</p> : null}

      {loaded.kind === "none" ? (
        <>
          <p>
            Canonical columns: <code>{CANONICAL_COLUMNS.join(",")}</code>. Column order does not matter, unknown columns
            are ignored, and you can map your broker&apos;s headers on the next step. Nothing is written until you
            commit.
          </p>
          <form action={uploadCsvAction}>
            <input type="file" name="file" accept=".csv,text/csv" required />{" "}
            <button type="submit">Upload and preview</button>
          </form>
        </>
      ) : null}

      {loaded.kind === "unparsable" ? (
        <>
          <p role="alert">
            {loaded.filename} could not be read as CSV ({loaded.reason.replace(/_/g, " ")} at line {loaded.line}).
          </p>
          <form action={discardImportAction}>
            <button type="submit">Discard</button>
          </form>
        </>
      ) : null}

      {loaded.kind === "preview" ? (
        <>
          <p>
            {loaded.filename}: {loaded.rowCount} data rows.{" "}
          </p>
          <form action={discardImportAction}>
            <button type="submit">Discard this upload</button>
          </form>

          <h2>Columns</h2>
          <form action={saveMappingAction}>
            {CANONICAL_COLUMNS.map((col) => (
              <label key={col}>
                {col}
                {REQUIRED_COLUMNS.includes(col) ? " (required)" : ""}{" "}
                <select
                  name={`map_${col}`}
                  defaultValue={loaded.map[col] ?? loaded.header.find((h) => h.trim().toLowerCase() === col) ?? ""}
                >
                  <option value="">— not in file —</option>
                  {loaded.header.map((h, i) => (
                    <option key={`${h}-${i}`} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button type="submit">Save mapping</button>
          </form>

          {!loaded.run.ok ? (
            <p role="alert">Required columns missing: {loaded.run.missing.join(", ")}. Map them above.</p>
          ) : (
            <>
              <h2>Preview</h2>
              <p>
                {loaded.run.counts.total} rows · {loaded.run.counts.valid} ready · {loaded.run.counts.errors} with
                errors · {loaded.run.counts.unresolved} unresolved · {loaded.run.counts.duplicates} duplicates
              </p>
              {loaded.run.unresolved.length > 0 ? (
                <>
                  <h3>Unresolved identifiers</h3>
                  {loaded.run.unresolved.map((u) => (
                    <section key={`${u.pack_id}|${u.instrument_kind}|${u.identifier}`}>
                      <p>
                        {u.pack_id} · {u.instrument_kind} · {u.identifier} — rows {u.rows.map((r) => r + 1).join(", ")}
                      </p>
                      {u.registered ? (
                        <AssetForm
                          action={createAssetThen.bind(null, "/transactions/import")}
                          values={{
                            pack_id: u.pack_id,
                            instrument_kind: u.instrument_kind,
                            identifier: u.identifier,
                            name: u.identifier,
                            native_currency: INSTANCE_DEFAULTS.baseCurrency,
                          }}
                          submitLabel="Create this asset"
                        />
                      ) : (
                        <p>This instrument kind is not registered in this build; these rows cannot be imported.</p>
                      )}
                    </section>
                  ))}
                </>
              ) : null}
              <form action={commitImportAction}>
                <input type="hidden" name="preview_hash" value={loaded.run.previewHash} />
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Identifier</th>
                      <th>Quantity</th>
                      <th>Unit price</th>
                      <th>Fees</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaded.run.rows.map((r) => (
                      <tr key={r.index}>
                        <td>{r.index + 1}</td>
                        <td>{r.values.date}</td>
                        <td>{r.values.type}</td>
                        <td>{r.values.identifier}</td>
                        <td>{r.values.quantity}</td>
                        <td>
                          {r.values.unit_price} {r.values.currency}
                        </td>
                        <td>{r.values.fees}</td>
                        <td>
                          {r.errors.length > 0 ? (
                            `error: ${r.errors.join(", ")}`
                          ) : r.assetId === null ? (
                            "unresolved"
                          ) : r.duplicate ? (
                            <label>
                              duplicate — <input type="checkbox" name="force" value={r.index} /> include anyway
                            </label>
                          ) : (
                            "ready"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  Commit writes every ready row in one transaction, skips duplicates unless included, and refuses if any
                  row has an error or an unresolved identifier.
                </p>
                <button type="submit" disabled={loaded.run.counts.errors > 0 || loaded.run.counts.unresolved > 0}>
                  Commit {loaded.run.counts.valid - loaded.run.counts.duplicates} rows
                </button>
              </form>
            </>
          )}
        </>
      ) : null}
    </main>
  );
}
