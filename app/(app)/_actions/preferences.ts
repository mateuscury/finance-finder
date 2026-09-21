"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { updatePreferences } from "@/lib/ledger/settings";
import { readSettings } from "@/lib/ledger/rows";
import { setPreferenceCookies } from "@/lib/settings/cookies";
import { parseTheme } from "@/lib/settings/preferences";

/** The nav's theme control (ARCHITECTURE §7): writes the setting and mirrors the cookie, then re-renders the shell. */
export async function setThemeAction(formData: FormData): Promise<void> {
  const { client, identity } = await requireUser();
  const theme = parseTheme(String(formData.get("theme") ?? ""));
  const settings = await readSettings(client);
  const result = await updatePreferences(client, identity.userId, { theme, locale: settings.locale });
  if (result.ok) await setPreferenceCookies({ theme });
  revalidatePath("/", "layout");
}
