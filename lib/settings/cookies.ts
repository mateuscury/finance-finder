/**
 * Writing the preference cookies (lib/settings/preferences.ts) from a
 * server action: the one place `user_settings.theme` and `.locale` are
 * mirrored to the request layer. Server-only (next/headers).
 */
import { cookies } from "next/headers";
import { LOCALE_COOKIE, PREFERENCE_COOKIE_OPTIONS, parseLocale, parseTheme, THEME_COOKIE } from "./preferences";

export async function setPreferenceCookies(prefs: { theme?: string | null; locale?: string | null }): Promise<void> {
  const jar = await cookies();
  if (prefs.theme != null) jar.set(THEME_COOKIE, parseTheme(prefs.theme), PREFERENCE_COOKIE_OPTIONS);
  if (prefs.locale != null) jar.set(LOCALE_COOKIE, parseLocale(prefs.locale), PREFERENCE_COOKIE_OPTIONS);
}

export async function clearPreferenceCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(THEME_COOKIE);
  jar.delete(LOCALE_COOKIE);
}
