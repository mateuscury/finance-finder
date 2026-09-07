/**
 * packs/global — sources and series that belong to no national market
 * (PACKS.md §13): FX fixings, crypto, and multi-market price vendors.
 *
 * `global` is the one pack id that is not ISO 3166-1 alpha-2. Its calendar is
 * a 7-day, no-holiday calendar: FX and crypto observations exist on any day and
 * staleness for these series is judged against the *consuming* pack's calendar.
 */
import { PACK_API_VERSION, type MarketPack, type SeriesDescriptor } from "../types";
import { bcbPtaxSource } from "./sources/bcb-ptax";

export const globalSeries: SeriesDescriptor[] = [
  {
    id: "global.usdbrl",
    label: "USD/BRL (PTAX)",
    kind: { kind: "fx_rate", base: "USD", quote: "BRL" },
    sourceId: "global.bcb_ptax",
    roles: ["fx", "benchmark"],
  },
];

export const globalPack: MarketPack = {
  apiVersion: PACK_API_VERSION,
  id: "global",
  name: "Global (FX, crypto, multi-market vendors)",
  currency: "USD",
  locale: "en-US",
  instruments: [],
  series: globalSeries,
  sources: [bcbPtaxSource],
  calendar: {
    timezone: "UTC",
    weekend: [],
    holidays: () => [],
    settlement: "T+0",
  },
  maintainers: ["mateuscury"],
  status: "draft",
};
