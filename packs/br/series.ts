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
    sourceId: "br.bcb_sgs",
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
  {
    id: "br.td_curve",
    label: "Tesouro Direto — taxas de referência",
    // Tenors in business days (BUS/252), matching how Brazilian curves are quoted.
    kind: { kind: "yield_curve", tenors: [21, 63, 126, 252, 504, 756, 1260, 2520, 5040, 7560] },
    sourceId: "br.tesouro_transparente",
    roles: ["discount_curve"],
  },
];
