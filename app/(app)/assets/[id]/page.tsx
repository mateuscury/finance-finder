import { notFound } from "next/navigation";
import { Notice } from "@/app/(app)/_components/notice";
import { requireUser } from "@/lib/auth/session";
import { ASSET_SELECT, type AssetDbRow } from "@/lib/ledger/rows";
import { AssetForm } from "../_form";
import { updateAssetAction } from "../actions";

export default async function EditAssetPage({ params, searchParams }: PageProps<"/assets/[id]">) {
  const { client } = await requireUser();
  const { id } = await params;
  const { data } = await client.from("assets").select(ASSET_SELECT).eq("id", id).maybeSingle();
  if (!data) notFound();
  const asset = data as AssetDbRow;
  const { count } = await client.from("transactions").select("*", { count: "exact", head: true }).eq("asset_id", id);
  const locked = (count ?? 0) > 0;
  const action = updateAssetAction.bind(null, id);
  return (
    <main>
      <h1>Edit {asset.identifier}</h1>
      <Notice searchParams={await searchParams} />
      {locked ? (
        <p>
          This asset has transactions: its pack, kind, identifier and currency are locked (name and metadata can
          change).
        </p>
      ) : null}
      <AssetForm
        action={action}
        values={{ ...asset, metadata: asset.metadata }}
        lockIdentity={locked}
        submitLabel="Save"
      />
    </main>
  );
}
