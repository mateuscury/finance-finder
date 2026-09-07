import type { SeriesDescriptor } from "../types";

/**
 * Series the BR pack registers (PACKS.md §6, §13).
 *
 * Whatever this pack registers with the `benchmark` role IS the benchmark list
 * (PACKS.md §6): CDI, SELIC, IPCA, Ibovespa, IFIX, plus USDBRL from `global`.
 * Adding another (IMA-B, IHFA, Poupança, …) needs a source on the licence
 * allowlist and a maintainer decision — Poupança via BCB SGS would be the easy one.
 *
 * Series ids double as the `ref` an adapter returns, so sources map them to
 * their upstream codes (see sources/bcb-sgs.ts).
 */
export const brSeries: SeriesDescriptor[] = [
  {
    id: "br.cdi",
    label: "CDI",
    kind: { kind: "rate_daily", dayCount: "BUS/252" },
    sourceId: "br.bcb_sgs",
    roles: ["benchmark", "accrual_index"],
  },
  {
    id: "br.selic",
    label: "SELIC",
    kind: { kind: "rate_daily", dayCount: "BUS/252" },
    sourceId: "br.bcb_sgs",
    roles: ["benchmark", "accrual_index"],
  },
  {
    id: "br.ipca",
    label: "IPCA",
    kind: { kind: "inflation_index", interpolation: "linear_daily" },
    // IBGE publishes the número-índice directly. BCB SGS 433 is a monthly
    // percentage change, and chaining it into a level would be math inside a
    // pack (MILESTONES.md decision 1).
    sourceId: "br.ibge_sidra",
    roles: ["benchmark", "deflator", "accrual_index"],
  },
  {
    id: "br.ibovespa",
    label: "Ibovespa",
    kind: { kind: "index_level" },
    sourceId: "br.brapi",
    roles: ["benchmark"],
  },
  {
    id: "br.ifix",
    label: "IFIX",
    kind: { kind: "index_level" },
    sourceId: "br.brapi",
    roles: ["benchmark"],
  },
];
