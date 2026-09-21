/**
 * The two display preferences a request must know before any database read
 * — the language of the copy and the theme of the page — mirrored from
 * `user_settings` into cookies by the server actions that change them
 * (Milestone 4 Phase 2). The root layout reads the cookies to set `lang` and
 * `data-theme` on `<html>` with no flash and no read; an unauthenticated
 * page gets the instance defaults.
 *
 * Cookie NAMES live here and nowhere else. The values are validated on the
 * way in: a cookie is client-controlled bytes.
 */
import { isSupportedLocale, type Locale } from "@/lib/copy";
import { INSTANCE_DEFAULTS } from "./defaults";

export const LOCALE_COOKIE = "ff-locale";
export const THEME_COOKIE = "ff-theme";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** A shipped locale, else the instance default (which is one). */
export function parseLocale(value: string | undefined | null): Locale {
  if (value && isSupportedLocale(value)) return value;
  return isSupportedLocale(INSTANCE_DEFAULTS.locale) ? INSTANCE_DEFAULTS.locale : "en";
}

export function parseTheme(value: string | undefined | null): Theme {
  return value && (THEMES as readonly string[]).includes(value) ? (value as Theme) : INSTANCE_DEFAULTS.theme;
}

/** One year, `httpOnly` — only the server reads them; never a secret, never a value. */
export const PREFERENCE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const;
