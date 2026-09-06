/**
 * BCB PTAX — the authoritative USDBRL fixing (PACKS.md §8, §13).
 * https://dadosabertos.bcb.gov.br/dataset/dolar-americano-usd-todos-os-boletins-diarios
 *
 * STATUS: declared, adapter not yet implemented (pack is `draft`).
 * Lives in `global`, not `br`, because FX between two currencies belongs to no
 * single national market.
 */
import type { PriceSource } from "../../types";

export const bcbPtaxSource: PriceSource = {
  id: "global.bcb_ptax",
  label: "BCB — PTAX",
  homepage: "https://dadosabertos.bcb.gov.br/",
  license: "public-domain",
  auth: "none",
  rateLimit: { requests: 10, perSeconds: 1 },
  capabilities: ["fx", "historical"],
  async fetch(req) {
    return { points: [], warnings: [`global.bcb_ptax: adapter not implemented (${req.capability})`] };
  },
};
