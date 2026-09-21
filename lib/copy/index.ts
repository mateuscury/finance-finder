/**
 * The languages this instance ships and the one way to pick one
 * (MILESTONES.md §4 decision 34). This file and `lib/settings/defaults.ts`
 * are the only places under app/ and lib/ that may name a locale
 * (`packs/conformance/kernel-neutrality.test.ts`): naming the languages an
 * instance ships is exactly what this file is for.
 *
 * `copyFor` matches the user's `user_settings.locale` exactly and falls
 * back to English; a pack's `locale` field never reaches here — it drives
 * number and date formatting only (PACKS.md §15).
 */
import { en } from "./en";
import { ptBR } from "./pt-BR";
import type { Copy } from "./types";

export const LOCALES = ["en", "pt-BR"] as const;
export type Locale = (typeof LOCALES)[number];

const DICTIONARIES: Record<Locale, Copy> = { en, "pt-BR": ptBR };

export function isSupportedLocale(locale: string): locale is Locale {
  return (LOCALES as readonly string[]).includes(locale);
}

export function copyFor(locale: string): Copy {
  return isSupportedLocale(locale) ? DICTIONARIES[locale] : en;
}

export type { Copy, DeleteOutcome, ImportOutcome, ReasonCode, RestoreOutcome } from "./types";
