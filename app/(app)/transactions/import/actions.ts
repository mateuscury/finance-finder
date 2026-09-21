"use server";
/**
 * CSV import actions (SPEC §9.1; decisions 24, 29, 30). Upload stores the
 * file's bytes for this user; mapping is saved once; commit re-runs the dry
 * run on the stored bytes, refuses unless the preview hash matches, inserts
 * every planned row in ONE statement, clears the upload and schedules the
 * snapshot rebuild after the response.
 */
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PACKS } from "@/packs";
import { requireUser } from "@/lib/auth/session";
import { snapshotsJob } from "@/lib/jobs";
import { normalizeColumnMap, planCommit, CANONICAL_COLUMNS } from "@/lib/import";
import { reasonFor } from "@/lib/ledger/result";
import { formValues } from "@/app/(app)/_lib/form";
import { loadDryRun } from "./load";

const IMPORT = "/transactions/import";

export async function uploadCsvAction(formData: FormData): Promise<void> {
  const { client, identity } = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(`${IMPORT}?error=no_file`);
  const content = await file.text();
  const { error } = await client
    .from("csv_imports")
    .upsert({ user_id: identity.userId, filename: file.name, content }, { onConflict: "user_id" });
  redirect(error ? `${IMPORT}?error=${reasonFor(error) === "invalid_input" ? "too_large" : "write_failed"}` : IMPORT);
}

export async function discardImportAction(): Promise<void> {
  const { client, identity } = await requireUser();
  await client.from("csv_imports").delete().eq("user_id", identity.userId);
  redirect(IMPORT);
}

export async function saveMappingAction(formData: FormData): Promise<void> {
  const { client, identity } = await requireUser();
  const raw: Record<string, string> = {};
  for (const col of CANONICAL_COLUMNS) {
    const v = formData.get(`map_${col}`);
    if (typeof v === "string") raw[col] = v;
  }
  const map = normalizeColumnMap(raw);
  const { error } = await client
    .from("user_settings")
    .upsert({ user_id: identity.userId, csv_column_map: map }, { onConflict: "user_id" });
  redirect(error ? `${IMPORT}?error=write_failed` : `${IMPORT}?saved=1`);
}

export async function commitImportAction(formData: FormData): Promise<void> {
  const started = Date.now();
  const { client, identity } = await requireUser();
  const { preview_hash } = formValues(formData, ["preview_hash"] as const);
  const force = new Set(
    formData
      .getAll("force")
      .map((v) => parseInt(String(v), 10))
      .filter((n) => Number.isInteger(n)),
  );

  const loaded = await loadDryRun(client, PACKS);
  if (loaded.kind !== "preview") redirect(`${IMPORT}?error=${loaded.kind === "none" ? "no_file" : loaded.reason}`);
  const plan = planCommit(loaded.run, preview_hash ?? "", force);
  if (!plan.ok) redirect(`${IMPORT}?error=${plan.reason}`);

  // One insert statement: a constraint failure on any row writes nothing.
  const { error } = await client
    .from("transactions")
    .insert(plan.rows.map((r) => ({ user_id: identity.userId, ...r })));
  if (error) redirect(`${IMPORT}?error=${reasonFor(error)}`);
  await client.from("csv_imports").delete().eq("user_id", identity.userId);

  const spent = Date.now() - started;
  after(() => snapshotsJob({ kind: "users", userIds: [identity.userId] }, spent));
  revalidatePath("/transactions");
  revalidatePath("/");
  redirect(`/transactions?imported=${plan.rows.length}&skipped=${plan.skippedDuplicates}`);
}
