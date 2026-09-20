/**
 * Asset writes (SPEC §9 screen 6; MILESTONES.md §3 decision 27). The caller
 * passes the user's own client: RLS scopes every read and write, and the
 * composite `(asset_id, user_id)` keys refuse anything a check missed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IdentifierSpec, MarketPack } from "@/packs/types";
import { fail, fromAffected, ok, reasonFor, type ActionResult } from "./result";
import { AssetEditableSchema, AssetInputSchema, failedFields, type AssetInput } from "./schemas";

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** The identifier in the form the pack's sources expect. */
export function normalizeIdentifier(spec: IdentifierSpec, raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  switch (spec) {
    case "ticker":
      return /^[A-Z0-9.^-]+$/.test(value.toUpperCase()) ? value.toUpperCase() : null;
    case "isin":
      return ISIN.test(value.toUpperCase()) ? value.toUpperCase() : null;
    case "custom":
      return value;
  }
}

/** Resolves and validates everything that does not need the database. */
export function prepareAsset(input: unknown, registry: readonly MarketPack[]): ActionResult<AssetInput> {
  const parsed = AssetInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", failedFields(parsed.error));
  const kind = registry.find((p) => p.id === parsed.data.pack_id)?.instruments.find((k) => k.id === parsed.data.instrument_kind);
  if (!kind) return fail("unknown_kind", ["instrument_kind"]);
  const identifier = normalizeIdentifier(kind.identifier, parsed.data.identifier);
  if (identifier === null) return fail("invalid_input", ["identifier"]);
  if (!kind.metadataSchema.safeParse(parsed.data.metadata).success) return fail("invalid_metadata", ["metadata"]);
  return ok({ ...parsed.data, identifier });
}

async function transactionCount(client: SupabaseClient, assetId: string): Promise<number | null> {
  const { count, error } = await client.from("transactions").select("*", { count: "exact", head: true }).eq("asset_id", assetId);
  return error ? null : (count ?? 0);
}

export async function createAsset(client: SupabaseClient, registry: readonly MarketPack[], userId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const prepared = prepareAsset(input, registry);
  if (!prepared.ok) return prepared;
  const { data, error } = await client.from("assets").insert({ user_id: userId, ...prepared.value }).select("id").single();
  if (error || !data) return fail(reasonFor(error));
  return ok({ id: data.id as string });
}

export async function updateAsset(client: SupabaseClient, registry: readonly MarketPack[], assetId: string, input: unknown): Promise<ActionResult> {
  const current = await client.from("assets").select("pack_id,instrument_kind,identifier,native_currency").eq("id", assetId).maybeSingle();
  if (current.error || !current.data) return fail("not_found");
  const prepared = prepareAsset(input, registry);
  if (!prepared.ok) return prepared;
  const identityChanged = (["pack_id", "instrument_kind", "identifier", "native_currency"] as const).some((k) => prepared.value[k] !== current.data![k]);
  if (identityChanged) {
    const n = await transactionCount(client, assetId);
    if (n === null) return fail("write_failed");
    if (n > 0) return fail("asset_identity_locked", ["identifier"]);
  }
  const patch = identityChanged ? prepared.value : AssetEditableSchema.parse(prepared.value);
  const { error } = await client.from("assets").update(patch).eq("id", assetId);
  return error ? fail(reasonFor(error)) : ok(undefined);
}

export async function deleteAsset(client: SupabaseClient, assetId: string): Promise<ActionResult> {
  const n = await transactionCount(client, assetId);
  if (n === null) return fail("write_failed");
  if (n > 0) return fail("asset_has_transactions");
  return fromAffected(await client.from("assets").delete().eq("id", assetId).select("id"));
}
