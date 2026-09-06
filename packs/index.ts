/**
 * Pack registry — checked in, one line per pack (PACKS.md §10).
 * Static imports resolved at build time. At runtime only packs listed in
 * `user_settings.enabled_packs` are activated; the rest contribute manifest
 * bytes and nothing else.
 */
import type { MarketPack } from "./types";
import { globalPack } from "./global";
import { brPack } from "./br";

export const PACKS: readonly MarketPack[] = [globalPack, brPack] as const;

export function getPack(id: string): MarketPack | undefined {
  return PACKS.find((p) => p.id === id);
}

export * from "./types";
