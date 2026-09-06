/**
 * AwesomeAPI — free FX quotes (PACKS.md §13 lists it as an `fx` source).
 * https://docs.awesomeapi.com.br/api-de-moedas
 *
 * STATUS: declared, adapter not yet implemented (pack is `draft`).
 */
import type { PriceSource } from "../../types";

export const awesomeApiSource: PriceSource = {
  id: "global.awesomeapi",
  label: "AwesomeAPI (FX)",
  homepage: "https://economia.awesomeapi.com.br/",
  license: "api-terms:public",
  auth: "none",
  rateLimit: { requests: 5, perSeconds: 1 },
  capabilities: ["fx", "historical"],
  async fetch(req) {
    return { points: [], warnings: [`global.awesomeapi: adapter not implemented (${req.capability})`] };
  },
};
