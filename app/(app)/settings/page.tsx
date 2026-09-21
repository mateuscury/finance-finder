import Link from "next/link";
import { PACKS } from "@/packs";
import { Notice } from "@/app/(app)/_components/notice";
import { requireUser } from "@/lib/auth/session";
import { copyFor, type DeleteOutcome, type RestoreOutcome } from "@/lib/copy";
import { readSettings } from "@/lib/ledger/rows";
import {
  changeBaseCurrencyAction,
  changePasswordAction,
  deleteEverythingAction,
  restoreBackupAction,
  setEnabledPacksAction,
  signOutEverywhereAction,
  unenrolTotpAction,
  updatePreferencesAction,
} from "./actions";
import type { SecurityReason } from "@/lib/auth/security";
import { TotpEnrol } from "./totp-enrol";

// Pack enable schedules a series backfill after the response (decision 30).
export const maxDuration = 60;

/** Settings (SPEC §9 screen 9): base currency, packs, theme/locale; security; your data. Design arrives in Milestone 5. */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { client, identity } = await requireUser();
  const params = await searchParams;
  const settings = await readSettings(client);
  const copy = copyFor(settings.locale);
  const factors = await client.auth.mfa.listFactors();
  const enrolled = (factors.data?.totp ?? []).length > 0;
  const enabled = new Set(settings.enabled_packs ?? []);
  const security = typeof params.security === "string" ? params.security : null;
  const restore = typeof params.restore === "string" ? params.restore : null;
  const del = typeof params.delete === "string" ? params.delete : null;

  return (
    <main>
      <h1>Settings</h1>
      <Notice searchParams={params} />
      {security ? (
        <p role="alert">{copy.security[security as SecurityReason | "factor_exists"] ?? copy.security.auth_failed}</p>
      ) : null}

      <h2>Portfolio</h2>
      <form action={changeBaseCurrencyAction}>
        <label>
          Base currency <input name="base_currency" defaultValue={settings.base_currency} pattern="[A-Z]{3}" required />
        </label>
        <label>
          <input type="checkbox" name="confirm_reset" /> I understand changing it after my first transaction discards
          every snapshot and rebuilds history in the new currency.
        </label>
        <button type="submit">Save base currency</button>
      </form>

      <form action={setEnabledPacksAction}>
        <fieldset>
          <legend>Enabled market packs</legend>
          {PACKS.map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                name="packs"
                value={p.id}
                defaultChecked={enabled.has(p.id)}
                disabled={p.status === "unmaintained"}
              />{" "}
              {p.id} — {p.name} · {p.instruments.length} instrument kinds · {p.series.length} series ·{" "}
              <em>{p.status}</em>
              {p.status === "draft"
                ? " — draft: incomplete or unvalidated; enable at your own discretion (PACKS.md §12)"
                : ""}
              {p.status === "unmaintained" ? " — cannot be enabled" : ""}
            </label>
          ))}
        </fieldset>
        <button type="submit">Save packs</button>
      </form>

      <form action={updatePreferencesAction}>
        <label>
          Theme{" "}
          <select name="theme" defaultValue={settings.theme}>
            <option value="system">system</option>
            <option value="light">light</option>
            <option value="dark">dark</option>
          </select>
        </label>
        <label>
          Locale <input name="locale" defaultValue={settings.locale} pattern="[a-z]{2}(-[A-Z]{2})?" required />
        </label>
        <button type="submit">Save preferences</button>
      </form>

      <h2>Security</h2>
      <p>
        Signed in as {identity.email ?? identity.userId}. Session level: {identity.currentLevel}.
      </p>
      <form action={changePasswordAction}>
        <label>
          New password <input name="password" type="password" autoComplete="new-password" minLength={12} required />
        </label>
        <label>
          Confirm <input name="confirm" type="password" autoComplete="new-password" minLength={12} required />
        </label>
        <button type="submit">Change password</button>
      </form>
      <h3>Second factor</h3>
      {enrolled ? (
        <>
          <p>An authenticator app is enrolled. Every session must confirm a code before any data shows.</p>
          <form action={unenrolTotpAction}>
            <button type="submit">Remove the authenticator</button>
          </form>
          <p>
            Lost the device? Recovery is <code>pnpm bootstrap:user --reset-mfa</code> on the host — never an email link.
          </p>
        </>
      ) : (
        <>
          <p>No second factor. A password alone opens this account.</p>
          <TotpEnrol />
        </>
      )}
      <form action={signOutEverywhereAction}>
        <button type="submit">Sign out everywhere</button>
      </form>

      <h2>Your data</h2>
      <p>
        You run the server, and the server sees your data: plaintext rows in your own Supabase project, encrypted at
        rest and in transit by Supabase. Pack sources learn what you hold, never how much.
      </p>
      <p>
        Last export: {settings.last_export_at ?? "never"}. Supabase&apos;s free tier keeps no automated backups.{" "}
        <Link href="/settings/export/json">Download backup (JSON)</Link> ·{" "}
        <Link href="/settings/export/csv">Download transactions (CSV)</Link>
      </p>
      <h3>Restore a backup</h3>
      {restore ? (
        <p role={restore === "done" ? "status" : "alert"}>
          {restore === "warnings"
            ? copy.restore.warnings({ count: parseInt(String(params.count), 10) || 0, codes: String(params.codes) })
            : (copy.restore[restore as RestoreOutcome] ?? copy.restore.write_failed)}
        </p>
      ) : null}
      <form action={restoreBackupAction}>
        <input type="file" name="file" accept=".json,application/json" required />
        <label>
          <input type="checkbox" name="acknowledge_warnings" /> restore even if some assets cannot be priced by this
          build
        </label>
        <button type="submit">Restore into this (empty) account</button>
      </form>
      <h3>Delete everything</h3>
      {del ? <p role="alert">{copy.delete[del as DeleteOutcome] ?? copy.delete.failed}</p> : null}
      <form action={deleteEverythingAction}>
        <p>
          Type <code>delete everything</code> and your password. The account and every row cascade; market data stays.
          This cannot be undone.
        </p>
        <input name="phrase" autoComplete="off" required />{" "}
        <input name="password" type="password" autoComplete="current-password" required />{" "}
        <button type="submit">Delete everything</button>
      </form>
    </main>
  );
}
