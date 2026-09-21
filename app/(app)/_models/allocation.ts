/**
 * The Allocation view model (SPEC §9 screen 3; US-011 AC-011.1), pure over
 * the latest snapshot rows: by instrument kind, by pack, by currency, and
 * native-vs-base exposure. Shares come from `sharesSummingTo100`, so each
 * view adds to exactly 100.00. A stale row is listed aside with its last
 * known value and takes no share (decision 10); a carried-forward row
 * counts (it is confident, just not fresh).
 */
import type { HoldingAsset } from "@/lib/calc/types";
import { KernelDecimal, toDecimalString, ZERO, type KDecimal } from "@/lib/calc/decimal";
import type { SnapshotAssetRow } from "@/lib/ledger/snapshots";
import { sharesSummingTo100 } from "./shares";

export interface AllocationSlice {
  key: string;
  label: string;
  valueBase: string;
  /** A unit share, "0.4567" = 45.67 %. */
  share: string;
}

export interface AllocationModel {
  date: string | null;
  baseCurrency: string | null;
  byKind: AllocationSlice[];
  byPack: AllocationSlice[];
  byCurrency: AllocationSlice[];
  /** Per native currency: Σ quantity × price (native) and Σ market value (base). */
  exposure: Array<{ currency: string; native: string; base: string }>;
  stale: Array<{ assetId: string; identifier: string; name: string; lastKnownBase: string; priceDate: string | null }>;
  /** Number of confident rows that named an asset this build does not know (kept in totals, labelled by id). */
  unresolved: number;
  empty: boolean;
}

function slices(groups: Map<string, { label: string; value: KDecimal }>): AllocationSlice[] {
  const sorted = [...groups.entries()].sort((a, b) => b[1].value.comparedTo(a[1].value));
  const shares = sharesSummingTo100(sorted.map(([, g]) => toDecimalString(g.value)));
  return sorted.map(([key, g], i) => ({ key, label: g.label, valueBase: toDecimalString(g.value), share: shares[i] }));
}

export function allocationModel(input: {
  rows: readonly SnapshotAssetRow[];
  assets: readonly HoldingAsset[];
  names: Record<string, string>;
}): AllocationModel {
  const byId = new Map(input.assets.map((a) => [a.id, a]));
  const confident = input.rows.filter((r) => r.status !== "stale");
  const stale = input.rows
    .filter((r) => r.status === "stale")
    .map((r) => {
      const a = byId.get(r.assetId);
      return {
        assetId: r.assetId,
        identifier: a?.identifier ?? r.assetId,
        name: input.names[r.assetId] ?? a?.identifier ?? r.assetId,
        lastKnownBase: r.marketValueBase,
        priceDate: r.priceDate,
      };
    });
  if (confident.length === 0) {
    return {
      date: input.rows[0]?.date ?? null,
      baseCurrency: input.rows[0]?.baseCurrency ?? null,
      byKind: [],
      byPack: [],
      byCurrency: [],
      exposure: [],
      stale,
      unresolved: 0,
      empty: true,
    };
  }

  const kind = new Map<string, { label: string; value: KDecimal }>();
  const pack = new Map<string, { label: string; value: KDecimal }>();
  const currency = new Map<string, { label: string; value: KDecimal }>();
  const exposure = new Map<string, { native: KDecimal; base: KDecimal }>();
  let unresolved = 0;
  const add = (m: Map<string, { label: string; value: KDecimal }>, key: string, label: string, v: KDecimal) => {
    const cur = m.get(key) ?? { label, value: ZERO };
    m.set(key, { label, value: cur.value.plus(v) });
  };
  for (const r of confident) {
    const a = byId.get(r.assetId);
    const base = new KernelDecimal(r.marketValueBase);
    if (!a) unresolved += 1;
    add(kind, a?.instrumentKind.id ?? "?", a?.instrumentKind.label ?? r.assetId, base);
    add(pack, a?.packId ?? "?", a?.packId ?? "?", base);
    const nativeCurrency = a?.nativeCurrency ?? r.baseCurrency;
    add(currency, nativeCurrency, nativeCurrency, base);
    const e = exposure.get(nativeCurrency) ?? { native: ZERO, base: ZERO };
    exposure.set(nativeCurrency, {
      native: e.native.plus(new KernelDecimal(r.quantity).times(r.priceNative)),
      base: e.base.plus(base),
    });
  }
  return {
    date: confident[0].date,
    baseCurrency: confident[0].baseCurrency,
    byKind: slices(kind),
    byPack: slices(pack),
    byCurrency: slices(currency),
    exposure: [...exposure.entries()]
      .sort((a, b) => b[1].base.comparedTo(a[1].base))
      .map(([c, e]) => ({ currency: c, native: toDecimalString(e.native), base: toDecimalString(e.base) })),
    stale,
    unresolved,
    empty: false,
  };
}
