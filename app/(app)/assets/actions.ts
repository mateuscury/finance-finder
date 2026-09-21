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
import { fieldsOf, valuesFromForm } from "@/lib/forms/zod-fields";
import { formValues, outcomeQuery } from "@/app/(app)/_lib/form";
import type { AssetFormState } from "./_form";

const ASSET_FIELDS = ["pack_id", "instrument_kind", "identifier", "name", "native_currency"] as const;

/** The submitted strings, echoed back so the form re-fills after a failure (the user's own input, never a stored value). */
function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

/** The metadata object from the form, through the fields the chosen kind's schema declares (decision 55). */
function metadataFor(formData: FormData): Record<string, unknown> {
  const packId = String(formData.get("pack_id") ?? "");
  const kindId = String(formData.get("instrument_kind") ?? "");
  const kind = PACKS.find((p) => p.id === packId)?.instruments.find((k) => k.id === kindId);
  return kind ? valuesFromForm(fieldsOf(kind.metadataSchema), formData) : {};
}

/**
 * Creates an asset and returns to `returnTo` — the assets page, or the CSV
 * import preview, which creates unresolved identifiers the same way and
 * with the same scoped fetch (SPEC §9.4). The `useActionState` contract
 * (decision 55): returns the failure so the form marks its fields inline,
 * redirects on success.
 */
export async function createAssetThen(
  returnTo: "/assets" | "/transactions/import",
  _prev: AssetFormState,
  formData: FormData,
): Promise<AssetFormState> {
  const started = Date.now();
  const { client, identity } = await requireUser();
  const result = await createAsset(client, PACKS, identity.userId, {
    ...formValues(formData, ASSET_FIELDS),
    metadata: metadataFor(formData),
  });
  if (!result.ok) return { ok: false, reason: result.reason, fields: result.fields, values: echo(formData) };
  const assetId = result.value.id;
  const spent = Date.now() - started;
  after(() => priceThenSnapshot({ kind: "assets", assetIds: [assetId] }, [identity.userId], spent));
  revalidatePath("/assets");
  revalidatePath("/");
  redirect(`${returnTo}?saved=1`);
}

export async function updateAssetAction(
  assetId: string,
  _prev: AssetFormState,
  formData: FormData,
): Promise<AssetFormState> {
  const { client } = await requireUser();
  const result = await updateAsset(client, PACKS, assetId, {
    ...formValues(formData, ASSET_FIELDS),
    metadata: metadataFor(formData),
  });
  if (!result.ok) return { ok: false, reason: result.reason, fields: result.fields, values: echo(formData) };
  revalidatePath("/assets");
  redirect("/assets?saved=1");
}

export async function deleteAssetAction(formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const { asset_id } = formValues(formData, ["asset_id"] as const);
  const result = await deleteAsset(client, asset_id ?? "");
  if (result.ok) revalidatePath("/assets");
  redirect(`/assets${outcomeQuery(result)}`);
}

/** Manual prices are set and removed on the asset's own page; the outcome lands there (SPEC §9.4). */
export async function setManualPriceAction(formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const values = formValues(formData, ["asset_id", "date", "price"] as const);
  const result = await setManualPrice(client, values);
  if (result.ok) {
    revalidatePath("/assets");
    revalidatePath("/");
  }
  redirect(`/assets/${values.asset_id ?? ""}${outcomeQuery(result)}#prices`);
}

export async function deleteManualPriceAction(formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const { asset_id, date } = formValues(formData, ["asset_id", "date"] as const);
  const result = await deleteManualPrice(client, asset_id ?? "", date ?? "");
  if (result.ok) {
    revalidatePath("/assets");
    revalidatePath("/");
  }
  redirect(`/assets/${asset_id ?? ""}${outcomeQuery(result)}#prices`);
}
