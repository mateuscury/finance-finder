/**
 * A synthetic five-year ledger, deterministic from a seed — the portfolio the
 * performance budgets are measured over (MILESTONES.md §4 decision 44;
 * docs/milestone-4-execution.md P6-U1).
 *
 * It is a `GoldenFixture` because that is the shape `seedGoldenPortfolio`
 * already writes to a real database: the budgets then run over exactly the
 * rows a real ledger has, not a second seeding path that could drift from it.
 * Unlike a pack's golden fixture it ships no `expected.json` — nothing here is
 * hand-derived and no test asserts its figures. Its only job is to be BIG and
 * shaped like a real portfolio: twenty assets over all seven BR kinds, a
 * monthly contribution to each, quarterly partial sells, monthly FII
 * dividends, daily prices with gaps, and the series the accrual kinds need.
 *
 * FIFO safety (decision 58): a sell is a fraction of the quantity the
 * generator has actually bought by that date. `lotsAt` throws `oversell` on a
 * ledger that sells more than it holds, so drawing sell quantities freely
 * would fail at seeding rather than at an assertion.
 *
 * Outside the kernel-neutrality rule by `SKIP_DIRS` in
 * `packs/conformance/kernel-neutrality.test.ts`: a test kit may name a real
 * pack.
 */
import { PACKS } from "@/packs";
import type { IsoDate, MarketCalendar } from "@/packs/types";
import { isBusinessDay } from "@/lib/calc/calendar";
import { addDays, addMonths, compareDates } from "@/lib/calc/dates";
import { KernelDecimal } from "@/lib/calc/decimal";
import { GoldenFixtureSchema, type GoldenFixture } from "@/lib/calc/golden";
import { todayIso } from "@/lib/clock";

/** Deterministic PRNG: one seed, one ledger, reproducible on any machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Style = "shares" | "units" | "principal";

interface SyntheticAsset {
  id: string;
  instrumentKind: string;
  identifier: string;
  metadata: Record<string, unknown>;
  style: Style;
  /** Priced kinds only: the source that quotes it and its opening price. */
  price: { sourceId: string; open: number; drift: number; vol: number } | null;
}

export interface SyntheticOptions {
  /** Last day of the ledger. Defaults to today — what a live portfolio looks like. */
  asOf?: IsoDate;
  /** Length of the history. Decision 44 measures five years. */
  years?: number;
}

const BRL = "BRL";

/** The twenty assets, across all seven kinds `packs/br` registers. */
function assetsOf(asOf: IsoDate): SyntheticAsset[] {
  const maturity = (months: number) => addMonths(asOf, months);
  const stock = (id: string, ticker: string, name: string, open: number): SyntheticAsset => ({
    id,
    instrumentKind: "br.stock",
    identifier: ticker,
    metadata: { name },
    style: "shares",
    price: { sourceId: "br.brapi", open, drift: 0.0002, vol: 0.016 },
  });
  const fii = (id: string, ticker: string, fundName: string, open: number): SyntheticAsset => ({
    id,
    instrumentKind: "br.fii",
    identifier: ticker,
    metadata: { fundName, segment: "Logística" },
    style: "shares",
    price: { sourceId: "br.brapi", open, drift: 0.0001, vol: 0.009 },
  });
  const tesouro = (id: string, slug: string, titulo: string, months: number, open: number): SyntheticAsset => ({
    id,
    instrumentKind: "br.tesouro_direto",
    identifier: `td:${slug}:${maturity(months)}`,
    metadata: { titulo, maturity: maturity(months) },
    style: "units",
    price: { sourceId: "br.tesouro_transparente", open, drift: 0.0003, vol: 0.002 },
  });
  const credit = (
    id: string,
    kind: string,
    identifier: string,
    issuer: string,
    rate: string,
    months: number,
  ): SyntheticAsset => ({
    id,
    instrumentKind: kind,
    identifier,
    metadata: { issuer, rate, maturity: maturity(months) },
    style: "principal",
    price: null,
  });

  return [
    stock("stk-petr", "PETR4", "Petrobras PN", 38.2),
    stock("stk-vale", "VALE3", "Vale ON", 61.4),
    stock("stk-itub", "ITUB4", "Itaú Unibanco PN", 33.1),
    stock("stk-bbas", "BBAS3", "Banco do Brasil ON", 27.8),
    stock("stk-wege", "WEGE3", "WEG ON", 52.6),
    stock("stk-bova", "BOVA11", "iShares Ibovespa ETF", 118.5),
    fii("fii-hglg", "HGLG11", "CSHG Logística", 151.0),
    fii("fii-knri", "KNRI11", "Kinea Renda Imobiliária", 142.3),
    fii("fii-mxrf", "MXRF11", "Maxi Renda", 10.4),
    fii("fii-xpml", "XPML11", "XP Malls", 104.7),
    tesouro("td-selic", "tesouro-selic", "Tesouro Selic", 30, 15000),
    tesouro("td-ipca", "tesouro-ipca", "Tesouro IPCA+ com Juros Semestrais", 72, 4100),
    tesouro("td-pre", "tesouro-prefixado", "Tesouro Prefixado", 40, 780),
    credit("cdb-a", "br.cdb", "cdb-banco-a-cdi", "Banco A", "1.10", 26),
    credit("cdb-b", "br.cdb", "cdb-banco-b-cdi", "Banco B", "1.02", 38),
    credit("lci-c", "br.lci_lca", "lci-banco-c", "Banco C", "0.95", 28),
    credit("lca-d", "br.lci_lca", "lca-banco-d", "Banco D", "0.92", 44),
    credit("pre-e", "br.cdb_prefixado", "cdb-banco-e-pre", "Banco E", "0.12", 32),
    credit("pre-f", "br.cdb_prefixado", "cdb-banco-f-pre", "Banco F", "0.115", 50),
    credit("ipca-g", "br.cdb_ipca", "cdb-banco-g-ipca", "Banco G", "0.06", 66),
  ];
}

/** Business days from `from` to `to` inclusive, on the pack's own calendar. */
function businessDays(calendar: MarketCalendar, from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; compareDates(d, to) <= 0; d = addDays(d, 1)) if (isBusinessDay(calendar, d)) out.push(d);
  return out;
}

const money = (n: number): string => new KernelDecimal(n).toFixed(2);

export interface SyntheticSummary {
  assets: number;
  transactions: number;
  cashFlows: number;
  prices: number;
  seriesPoints: number;
  from: IsoDate;
  to: IsoDate;
}

/** The row counts of a fixture, for a budgets table that states what it measured. */
export function summariseLedger(fixture: GoldenFixture): SyntheticSummary {
  const dates = fixture.transactions.map((t) => t.tradeDate).sort(compareDates);
  return {
    assets: fixture.assets.length,
    transactions: fixture.transactions.length,
    cashFlows: fixture.cashFlows.length,
    prices: Object.values(fixture.prices).reduce((n, rows) => n + rows.length, 0),
    seriesPoints: Object.values(fixture.series).reduce((n, rows) => n + rows.length, 0),
    from: dates[0] ?? fixture.asOf,
    to: fixture.asOf,
  };
}

export function syntheticLedger(seed: number, options: SyntheticOptions = {}): GoldenFixture {
  const random = mulberry32(seed);
  const asOf = options.asOf ?? todayIso();
  const years = options.years ?? 5;
  const pack = PACKS.find((p) => p.id === "br");
  if (!pack) throw new Error("syntheticLedger: the br pack is not registered");
  const calendar = pack.calendar;

  const start = addMonths(asOf, -12 * years);
  const days = businessDays(calendar, start, asOf);
  if (days.length === 0) throw new Error("syntheticLedger: the window contains no business day");
  const onOrAfter = (date: IsoDate): IsoDate | null => days.find((d) => compareDates(d, date) >= 0) ?? null;

  const assets = assetsOf(asOf);
  const transactions: GoldenFixture["transactions"] = [];
  const cashFlows: GoldenFixture["cashFlows"] = [];
  const prices: GoldenFixture["prices"] = {};
  const series: GoldenFixture["series"] = {};

  // --- prices: a random walk on every business day, with ~3 % of days missing
  // so carry-forward is exercised the way a real source's gaps do it.
  for (const asset of assets) {
    if (!asset.price) continue;
    const rows: GoldenFixture["prices"][string] = [];
    let level = asset.price.open;
    for (const date of days) {
      level = Math.max(0.01, level * (1 + asset.price.drift + (random() - 0.5) * asset.price.vol));
      if (random() < 0.03) continue;
      rows.push({ date, price: money(level), currency: BRL, sourceId: asset.price.sourceId });
    }
    prices[asset.identifier] = rows;
  }

  // --- series: CDI and SELIC daily (unit form, never percentage points),
  // IPCA monthly as an index LEVEL (the kernel interpolates it linearly).
  const cdi: GoldenFixture["series"][string] = [];
  const selic: GoldenFixture["series"][string] = [];
  for (const date of days) {
    const daily = 0.00045 + (random() - 0.5) * 0.00008;
    cdi.push({ date, value: new KernelDecimal(daily).toFixed(8), tenorDays: 0 });
    selic.push({ date, value: new KernelDecimal(daily * 1.001).toFixed(8), tenorDays: 0 });
  }
  series["br.cdi"] = cdi;
  series["br.selic"] = selic;

  const ipca: GoldenFixture["series"][string] = [];
  let index = 6500;
  for (let m = 0; ; m++) {
    const date = addMonths(`${start.slice(0, 7)}-01`, m);
    const last = addDays(addMonths(date, 1), -1);
    if (compareDates(last, asOf) > 0) break;
    index *= 1 + 0.0035 + (random() - 0.5) * 0.004;
    ipca.push({ date: last, value: money(index), tenorDays: 0 });
  }
  series["br.ipca"] = ipca;

  // --- transactions: a monthly contribution to every asset, quarterly partial
  // sells on three, monthly rent on every FII. One deposit per buy, one
  // withdrawal per sell: there is no cash ledger, so an unfunded buy would
  // read as a gain.
  const held = new Map<string, number>(assets.map((a) => [a.id, 0]));
  const priceOn = (asset: SyntheticAsset, date: IsoDate): number => {
    const rows = prices[asset.identifier];
    if (!rows || rows.length === 0) return 1;
    let chosen = rows[0];
    for (const row of rows) {
      if (compareDates(row.date, date) > 0) break;
      chosen = row;
    }
    return Number(chosen.price);
  };
  const sellers = new Set(["stk-petr", "stk-vale", "fii-mxrf"]);
  let n = 0;
  const id = (prefix: string) => `${prefix}-${String(++n).padStart(5, "0")}`;

  const months = years * 12;
  for (let m = 0; m <= months; m++) {
    const monthStart = addMonths(`${start.slice(0, 7)}-01`, m);
    const buyDate = onOrAfter(`${monthStart.slice(0, 7)}-05`);
    if (!buyDate || compareDates(buyDate, asOf) > 0) continue;

    for (const asset of assets) {
      let quantity: string;
      let unitPrice: string;
      let fees: string;
      if (asset.style === "principal") {
        quantity = "1";
        unitPrice = money(1000 + Math.floor(random() * 40) * 50);
        fees = "0";
      } else if (asset.style === "units") {
        quantity = new KernelDecimal(0.5 + Math.floor(random() * 20) / 10).toFixed(2);
        unitPrice = money(priceOn(asset, buyDate));
        fees = "0";
      } else {
        quantity = String(5 + Math.floor(random() * 30));
        unitPrice = money(priceOn(asset, buyDate));
        fees = money(2 + random() * 8);
      }
      transactions.push({
        id: id("t"),
        assetId: asset.id,
        tradeDate: buyDate,
        type: "buy",
        quantity,
        unitPrice,
        currency: BRL,
        fees,
        fxRate: null,
      });
      held.set(asset.id, (held.get(asset.id) ?? 0) + Number(quantity));
      cashFlows.push({
        id: id("c"),
        date: buyDate,
        amount: money(new KernelDecimal(quantity).times(unitPrice).plus(fees).toNumber()),
        currency: BRL,
      });
    }

    // Rent: FIIs distribute monthly. Quantity 0, the unit price IS the amount.
    for (const asset of assets) {
      if (asset.instrumentKind !== "br.fii") continue;
      const open = held.get(asset.id) ?? 0;
      if (open <= 0) continue;
      const payDate = onOrAfter(`${monthStart.slice(0, 7)}-15`);
      if (!payDate || compareDates(payDate, asOf) > 0) continue;
      transactions.push({
        id: id("t"),
        assetId: asset.id,
        tradeDate: payDate,
        type: "dividend",
        quantity: "0",
        unitPrice: money(open * (0.6 + random() * 0.5)),
        currency: BRL,
        fees: "0",
        fxRate: null,
      });
    }

    // A quarter's end: three assets sell a quarter of what they hold. Never
    // more — `lotsAt` would throw `oversell` at seeding time.
    if (m % 3 === 2) {
      for (const asset of assets) {
        if (!sellers.has(asset.id)) continue;
        const open = held.get(asset.id) ?? 0;
        const quantity = Math.floor(open * 0.25);
        if (quantity < 1) continue;
        const sellDate = onOrAfter(`${monthStart.slice(0, 7)}-22`);
        if (!sellDate || compareDates(sellDate, asOf) > 0) continue;
        const unitPrice = money(priceOn(asset, sellDate));
        transactions.push({
          id: id("t"),
          assetId: asset.id,
          tradeDate: sellDate,
          type: "sell",
          quantity: String(-quantity),
          unitPrice,
          currency: BRL,
          fees: money(1 + random() * 4),
          fxRate: null,
        });
        held.set(asset.id, open - quantity);
        cashFlows.push({
          id: id("c"),
          date: sellDate,
          amount: money(-new KernelDecimal(quantity).times(unitPrice).toNumber()),
          currency: BRL,
        });
      }
    }
  }

  // Valuation dates: every month's last business day, plus `asOf`. Only a
  // caller running the golden runner over this fixture uses them; the
  // snapshot job derives its own days from the calendar.
  const monthEnds = new Set<IsoDate>();
  for (const date of days) monthEnds.add(date);
  const valuationDates = [...monthEnds]
    .filter((d, i, all) => i === all.length - 1 || all[i + 1].slice(0, 7) !== d.slice(0, 7))
    .concat(asOf)
    .filter((d, i, all) => all.indexOf(d) === i)
    .sort(compareDates);

  return GoldenFixtureSchema.parse({
    $comment: `Synthetic ${years}-year ledger, seed ${seed} — generated by lib/testing/synthetic.ts for the performance budgets. Not a market record.`,
    baseCurrency: BRL,
    asOf,
    valuationDates,
    assets: assets.map((a) => ({
      id: a.id,
      instrumentKind: a.instrumentKind,
      identifier: a.identifier,
      nativeCurrency: BRL,
      metadata: a.metadata,
    })),
    transactions,
    cashFlows,
    prices,
    series,
  });
}
