import { PACKS } from "@/packs";
import { requireUser } from "@/lib/auth/session";
import { listAssets } from "@/lib/ledger/queries";

/** Assets list (SPEC §9 screen 6; §9.4 outcome shown on the row). Forms arrive in Phase 4. */
export default async function AssetsPage() {
  const { client } = await requireUser();
  const assets = await listAssets(client, PACKS);
  return (
    <main>
      <h1>Assets</h1>
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
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id}>
                <td>{a.identifier}</td>
                <td>{a.name}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
