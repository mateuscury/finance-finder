/**
 * brapi.dev — B3 quotes (equities, FIIs, indices). Requires a free API key.
 * https://brapi.dev/docs
 *
 * STATUS: declared, adapter not yet implemented (pack is `draft`).
 * Implement in Milestone 1 using ctx.http only; record fixtures for success,
 * empty, 5xx and 429 (PACKS.md §11.3).
 */
import type { PriceSource } from "../../types";

export const brapiSource: PriceSource = {
  id: "br.brapi",
  label: "brapi.dev",
  homepage: "https://brapi.dev/",
  license: "api-terms:free-tier",
  auth: "api_key",
  envVars: ["BRAPI_TOKEN"],
  rateLimit: { requests: 1, perSeconds: 1 },
  capabilities: ["spot", "historical", "series"],
  async fetch(req) {
    return {
      points: [],
      warnings: [`br.brapi: adapter not implemented (requested ${req.capability} for ${req.refs.length} refs)`],
    };
  },
};
