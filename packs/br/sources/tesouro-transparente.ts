/**
 * Tesouro Transparente — daily Tesouro Direto prices and rates (open data CSV).
 * https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto
 *
 * STATUS: declared, adapter not yet implemented (pack is `draft`).
 * The dataset is a single large CSV; the adapter must stream/parse it inside the
 * per-source time budget of the cron job (PACKS.md §10).
 */
import type { PriceSource } from "../../types";

export const tesouroTransparenteSource: PriceSource = {
  id: "br.tesouro_transparente",
  label: "Tesouro Transparente",
  homepage: "https://www.tesourotransparente.gov.br/",
  license: "public-domain",
  auth: "none",
  rateLimit: { requests: 1, perSeconds: 10 },
  capabilities: ["spot", "historical", "series"],
  async fetch(req) {
    return {
      points: [],
      warnings: [`br.tesouro_transparente: adapter not implemented (requested ${req.capability})`],
    };
  },
};
