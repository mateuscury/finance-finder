/**
 * The instance's defaults — the ONLY place `app/` or `lib/` may name a
 * pack, a currency or a locale (MILESTONES.md §4 decision 42). These mirror
 * the database defaults in the initial migration; `packs/conformance/
 * kernel-neutrality.test.ts` fails on any other literal site.
 */
export const INSTANCE_DEFAULTS = {
  baseCurrency: "BRL",
  locale: "pt-BR",
  theme: "system",
  enabledPacks: [] as string[],
} as const;
