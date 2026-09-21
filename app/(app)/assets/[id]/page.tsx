import { notFound } from "next/navigation";
import { Notice } from "@/app/(app)/_components/notice";
import { requireUser } from "@/lib/auth/session";
import { ASSET_SELECT } from "@/lib/ledger/rows";
import { PACKS } from "@/packs";
import { currentCopy } from "@/lib/copy/server";
import { AssetForm } from "../_form";
import { kindOptions } from "../_kinds";
import { updateAssetAction } from "../actions";

export default async function EditAssetPage({ params, searchParams }: PageProps<"/assets/[id]">) {
  const { client } = await requireUser();
  const copy = await currentCopy();
  const { id } = await params;
  const { data } = await client.from("assets").select(ASSET_SELECT).eq("id", id).maybeSingle();
  if (!data) notFound();
  const asset = data;
  const { count } = await client.from("transactions").select("*", { count: "exact", head: true }).eq("asset_id", id);
  const locked = (count ?? 0) > 0;
  const action = updateAssetAction.bind(null, id);
  return (
    <main>
      <h1>Edit {asset.identifier}</h1>
      <Notice searchParams={await searchParams} />
      <AssetForm
        action={action}
        kinds={kindOptions(PACKS)}
        values={{ ...asset, metadata: asset.metadata }}
        lockIdentity={locked}
        submitLabel="Save"
        copy={{ ...copy.screens.assetForm, reasons: copy.reasons }}
      />
    </main>
  );
}
