import { PACK_API_VERSION, type MarketPack } from "../types";
import { brCalendar } from "./calendar";
import { brInstruments } from "./instruments";
import { brSeries } from "./series";
import { bcbSgsSource } from "./sources/bcb-sgs";
import { brapiSource } from "./sources/brapi";
import { ibgeSidraSource } from "./sources/ibge-sidra";
import { tesouroTransparenteSource } from "./sources/tesouro-transparente";

export const brPack: MarketPack = {
  apiVersion: PACK_API_VERSION,
  id: "br",
  name: "Brazil",
  currency: "BRL",
  locale: "pt-BR",
  instruments: brInstruments,
  series: brSeries,
  sources: [bcbSgsSource, ibgeSidraSource, brapiSource, tesouroTransparenteSource],
  calendar: brCalendar,
  maintainers: ["mateuscury"],
  status: "supported",
  dependencies: ["global"],
};
