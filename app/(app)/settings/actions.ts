"use server";
/**
 * Settings actions (SPEC §9 screen 9, §9.6, §12.3; decisions 26, 28, 29).
 * Every action verifies the session first. Security-posture changes
 * (password, factor removal, delete everything) additionally require AAL2
 * when a factor is enrolled, through `requireAal2`.
 */
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { PACKS } from "@/packs";
import { requireAal2, requireUser } from "@/lib/auth/session";
import {
  changePassword,
  confirmTotp,
  enrolTotp,
  signOutEverywhere,
  unenrolTotp,
  verifyPassword,
  type Enrolment,
  type SecurityReason,
} from "@/lib/auth/security";
import { planRestore } from "@/lib/backup";
import { deleteUserJob, ingestJob } from "@/lib/jobs";
import { changeBaseCurrency, setEnabledPacks, updatePreferences } from "@/lib/ledger/settings";
import { publicEnv } from "@/lib/env";
import { asJson, type Database } from "@/lib/supabase/types";
import { formValues, outcomeQuery } from "@/app/(app)/_lib/form";

const SETTINGS = "/settings";

export async function changeBaseCurrencyAction(formData: FormData): Promise<void> {
  const { client, identity } = await requireUser();
  const { base_currency, confirm_reset } = formValues(formData, ["base_currency", "confirm_reset"] as const);
  const result = await changeBaseCurrency(client, identity.userId, {
    base_currency,
    confirmReset: confirm_reset === "on",
  });
  if (result.ok) revalidatePath("/");
  redirect(`${SETTINGS}${outcomeQuery(result)}`);
}

export async function setEnabledPacksAction(formData: FormData): Promise<void> {
  const started = Date.now();
  const { client, identity } = await requireUser();
  const packIds = formData.getAll("packs").map(String);
  const result = await setEnabledPacks(client, identity.userId, PACKS, packIds);
  if (result.ok && result.value.newlyEnabled.length > 0) {
    const newlyEnabled = result.value.newlyEnabled;
    const spent = Date.now() - started;
    // Backfill the new packs' series after the response, so benchmarks exist before the first nightly run (SPEC §9.4).
    after(() => ingestJob({ kind: "new_packs", packIds: newlyEnabled }, spent));
  }
  redirect(`${SETTINGS}${outcomeQuery(result)}`);
}

export async function updatePreferencesAction(formData: FormData): Promise<void> {
  const { client, identity } = await requireUser();
  const result = await updatePreferences(client, identity.userId, formValues(formData, ["theme", "locale"] as const));
  redirect(`${SETTINGS}${outcomeQuery(result)}`);
}

const securityQuery = (r: { ok: true } | { ok: false; reason: SecurityReason }) =>
  r.ok ? "?saved=1" : `?security=${r.reason}`;

export async function changePasswordAction(formData: FormData): Promise<void> {
  const session = await requireAal2();
  if ("reason" in session) redirect(`${SETTINGS}?security=aal2_required`);
  const result = await changePassword(session.client, formValues(formData, ["password", "confirm"] as const));
  redirect(`${SETTINGS}${securityQuery(result)}`);
}

/** Step 1 of enrolment, called from the client widget: returns the QR to render, never via a URL. */
export async function enrolTotpAction(): Promise<
  { ok: true; enrolment: Enrolment } | { ok: false; reason: SecurityReason }
> {
  const { client } = await requireUser();
  const result = await enrolTotp(client);
  return result.ok ? { ok: true, enrolment: result.value } : { ok: false, reason: result.reason };
}

export async function confirmTotpAction(formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const result = await confirmTotp(client, formValues(formData, ["factorId", "code"] as const));
  redirect(`${SETTINGS}${securityQuery(result)}`);
}

export async function unenrolTotpAction(): Promise<void> {
  const session = await requireAal2();
  if ("reason" in session) redirect(`${SETTINGS}?security=aal2_required`);
  const result = await unenrolTotp(session.client);
  redirect(`${SETTINGS}${securityQuery(result)}`);
}

export async function signOutEverywhereAction(): Promise<void> {
  const { client } = await requireUser();
  await signOutEverywhere(client);
  redirect("/login");
}

/**
 * Restore (SPEC §12.3; decision 4): parse, plan, and — unless the plan's
 * warnings were acknowledged — show them first. The database enforces the
 * rest (empty account, ownership) inside `restore_backup`.
 */
export async function restoreBackupAction(formData: FormData): Promise<void> {
  const { client } = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(`${SETTINGS}?restore=no_file`);
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    redirect(`${SETTINGS}?restore=invalid_backup`);
  }
  const plan = planRestore(json, PACKS);
  if (!plan.ok) redirect(`${SETTINGS}?restore=${plan.reason}`);
  const acknowledged = formData.get("acknowledge_warnings") === "on";
  if (plan.warnings.length > 0 && !acknowledged) {
    const codes = [...new Set(plan.warnings.map((w) => w.code))].join(",");
    redirect(`${SETTINGS}?restore=warnings&codes=${codes}&count=${plan.warnings.length}`);
  }
  const { error } = await client.rpc("restore_backup", { payload: asJson(plan.payload) });
  if (error) {
    const m = /restore_refused: ([a-z_]+)/.exec(error.message ?? "");
    redirect(`${SETTINGS}?restore=${m ? m[1] : "write_failed"}`);
  }
  revalidatePath("/");
  redirect(`${SETTINGS}?restore=done`);
}

/** SPEC §12.3 "Delete everything": the phrase typed and the password re-entered, then the auth user goes under the service role. */
export async function deleteEverythingAction(formData: FormData): Promise<void> {
  const session = await requireAal2();
  if ("reason" in session) redirect(`${SETTINGS}?security=aal2_required`);
  const { phrase, password } = formValues(formData, ["phrase", "password"] as const);
  if (phrase !== "delete everything" || !password || !session.identity.email) redirect(`${SETTINGS}?delete=phrase`);
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey } = publicEnv();
  const fresh = await verifyPassword(
    () =>
      createClient<Database>(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    session.identity.email,
    password,
  );
  if (!fresh) redirect(`${SETTINGS}?delete=password`);
  const { ok } = await deleteUserJob(session.identity.userId);
  if (!ok) redirect(`${SETTINGS}?delete=failed`);
  await session.client.auth.signOut({ scope: "local" });
  redirect("/login");
}
