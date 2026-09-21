/**
 * SPEC §12.3 "Export": `finance-finder-YYYY-MM-DD.json` from `export_backup()`
 * through the deterministic serializer, and `transactions-YYYY-MM-DD.csv` in
 * the §9.1 canonical format so the app's own import reads it back as a
 * no-op. Each download stamps `user_settings.last_export_at`.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { parseBackup, serializeBackup } from "@/lib/backup";
import { writeCsv } from "@/lib/csv/write";
import { CANONICAL_COLUMNS } from "@/lib/import";
import { stampExport } from "@/lib/ledger/settings";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/settings/export/[format]">) {
  const { client, identity } = await requireUser();
  const { format } = await params;
  if (format !== "json" && format !== "csv") return NextResponse.json({ error: "unknown_format" }, { status: 404 });

  const { data, error } = await client.rpc("export_backup");
  if (error) return NextResponse.json({ error: "export_failed" }, { status: 500 });
  const parsed = parseBackup(data);
  if (!parsed.ok) return NextResponse.json({ error: "export_invalid" }, { status: 500 });

  const today = new Date().toISOString().slice(0, 10);
  await stampExport(client, identity.userId);

  if (format === "json") {
    return new NextResponse(serializeBackup(parsed.backup), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="finance-finder-${today}.json"`,
      },
    });
  }
  const assets = new Map(parsed.backup.assets.map((a) => [a.id, a] as const));
  const rows = parsed.backup.transactions.map((t) => {
    const a = assets.get(t.asset_id);
    return [
      t.trade_date,
      t.type,
      a?.pack_id ?? "",
      a?.instrument_kind ?? "",
      a?.identifier ?? "",
      t.quantity,
      t.unit_price,
      t.currency,
      t.fees,
      t.note ?? "",
    ];
  });
  return new NextResponse(writeCsv([...CANONICAL_COLUMNS], rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="transactions-${today}.csv"`,
    },
  });
}
