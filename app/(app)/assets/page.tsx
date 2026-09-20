import Link from "next/link";
import { PACKS } from "@/packs";
import { Notice } from "@/app/(app)/_components/notice";
import { requireUser } from "@/lib/auth/session";
import { listAssets } from "@/lib/ledger/queries";
import { AssetForm } from "./_form";
import { createAssetAction, deleteAssetAction, deleteManualPriceAction, setManualPriceAction } from "./actions";

// The create action schedules the price-then-snapshot chain after the response (decision 30).
export const maxDuration = 60;

/** Assets (SPEC §9 screen 6; §9.4 outcome on the row). */
export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const { client } = await requireUser();
  const params = await searchParams;
  const assets = await listAssets(client, PACKS);
  return (
    <main>
      <h1>Assets</h1>
      <Notice searchParams={params} />
      {assets.length === 0 ? (
        <p>Add what you hold. Or import a CSV — unknown identifiers can be created from the preview.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Identifier</th>
              <th>Name</th>
              <th>Kind</th>
              <th>Currency</th>
              <th>Price</th>
              <th>Manual price</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id}>
                <td>{a.identifier}</td>
                <td>
                  <Link href={`/assets/${a.id}`}>{a.name}</Link>
                </td>
                <td>{a.kindLabel ?? `${a.instrument_kind} (not registered in this build)`}</td>
                <td>{a.native_currency}</td>
                <td>
                  {a.latest
                    ? `${a.latest.price} ${a.latest.currency} · ${a.latest.sourceId} · ${a.latest.date}`
                    : a.valuation === "accrual"
                      ? "accrues from the contracted rate"
                      : a.sourceError
                        ? `unpriced — ${a.sourceId}: ${a.sourceError}`
                        : "unpriced"}
                </td>
                <td>
                  {a.valuation === "accrual" ? null : (
                    <form action={setManualPriceAction}>
                      <input type="hidden" name="asset_id" value={a.id} />
                      <input name="date" type="date" required /> <input name="price" inputMode="decimal" placeholder="price" required />{" "}
                      <button type="submit">Set</button>
                    </form>
                  )}
                  {a.latest?.sourceId === "manual" ? (
                    <form action={deleteManualPriceAction}>
                      <input type="hidden" name="asset_id" value={a.id} />
                      <input type="hidden" name="date" value={a.latest.date} />
                      <button type="submit">Remove manual price for {a.latest.date}</button>
                    </form>
                  ) : null}
                </td>
                <td>
                  <form action={deleteAssetAction}>
                    <input type="hidden" name="asset_id" value={a.id} />
                    <button type="submit">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Add an asset</h2>
      <AssetForm action={createAssetAction} submitLabel="Add asset" />
    </main>
  );
}
