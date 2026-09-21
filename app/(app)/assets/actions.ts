"use server";
/**
 * Asset actions (SPEC §9 screen 6, §9.4; decisions 27, 29, 30). Each
 * verifies the session first, parses the form, calls the ledger module with
 * the user's own client, revalidates, and redirects with the outcome.
 * Creating an asset schedules the price-then-snapshot chain AFTER the
 * response, under the service role in lib/jobs, with the ids this action
 * just created — never a form value.
 */
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PACKS } from "@/packs";
import { requireUser } from "@/lib/auth/session";
import { priceThenSnapshot } from "@/lib/jobs";
import { createAsset, deleteAsset, updateAsset } from "@/lib/ledger/assets";
import { deleteManualPrice, setManualPrice } from "@/lib/ledger/prices";
import { formValues, metadataFromForm, outcomeQuery } from "@/app/(app)/_lib/form";

const ASSET_FIELDS = ["pack_id", "instrument_kind", "identifier", "name", "native_currency"] as const;

/**
 * Creates an asset and returns to `returnTo` — the assets page, or the CSV
 * import preview, which creates unresolved identifiers the same way and
 * with the same scoped fetch (SPEC §9.4).
 */
export async function createAssetThen(returnTo: "/assets" | "/transactions/import", formData: FormData): Promise<void> {
  const started = Date.now();
  const { client, identity } = await requireUser();
  const metadata = metadataFromForm(formData);
  const result =
    metadata === null
      ? ({ ok: false, reason: "invalid_metadata", fields: ["metadata"] } as const)
      : await createAsset(client, PACKS, identity.userId, { ...formValues(formData, ASSET_FIELDS), metadata });
  if (result.ok) {
    const assetId = result.value.id;
    const spent = Date.now() - started;
    after(() => priceThenSnapshot({ kind: "assets", assetIds: [assetId] }, [identity.userId], spent));
    revalidatePath("/assets");
    revalidatePath("/");
  }
  redirect(`${returnTo}${outcomeQuery(result)}`);
}

export async function updateAssetAction(assetId: string, formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const metadata = metadataFromForm(formData);
  const result =
    metadata === null
      ? ({ ok: false, reason: "invalid_metadata", fields: ["metadata"] } as const)
      : await updateAsset(client, PACKS, assetId, { ...formValues(formData, ASSET_FIELDS), metadata });
  if (result.ok) {
    revalidatePath("/assets");
    redirect("/assets?saved=1");
  }
  redirect(`/assets/${assetId}${outcomeQuery(result)}`);
}

export async function deleteAssetAction(formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const { asset_id } = formValues(formData, ["asset_id"] as const);
  const result = await deleteAsset(client, asset_id ?? "");
  if (result.ok) revalidatePath("/assets");
  redirect(`/assets${outcomeQuery(result)}`);
}

export async function setManualPriceAction(formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const result = await setManualPrice(client, formValues(formData, ["asset_id", "date", "price"] as const));
  if (result.ok) revalidatePath("/assets");
  redirect(`/assets${outcomeQuery(result)}`);
}

export async function deleteManualPriceAction(formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const { asset_id, date } = formValues(formData, ["asset_id", "date"] as const);
  const result = await deleteManualPrice(client, asset_id ?? "", date ?? "");
  if (result.ok) revalidatePath("/assets");
  redirect(`/assets${outcomeQuery(result)}`);
}

/** Refresh (SPEC §9.4): re-run the scoped fetch for everything unpriced, then snapshots — after the response. */
export async function refreshAction(): Promise<void> {
  const started = Date.now();
  const { identity } = await requireUser();
  const spent = Date.now() - started;
  after(() => priceThenSnapshot({ kind: "unpriced" }, [identity.userId], spent));
  redirect("/assets?refreshing=1");
}
