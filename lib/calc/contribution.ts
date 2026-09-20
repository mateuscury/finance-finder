/**
 * Per-asset contribution over `[from, to]` (docs/milestone-2-plan.md
 * "Contribution"; MILESTONES.md §2 decision 15).
 *
 *   gain_i = V_i(to) − V_i(from) − netInvested_i((from, to])
 *   D      = V(from) + Σ external flows in (from, to]
 *   c_i    = gain_i / D
 *
 * Every term shares `D`, so Σ c_i is exactly the period's simple return
 * `(V(to) − V(from) − Σ netInvested) / D`. Over a period with many flows this
 * approximates TWR and is documented as such.
 *
 * `netInvested_i` is rebuilt in BASE currency by converting each transaction's
 * cash effect with `toBase` at its own trade date (decision 15) — never with
 * the row's display-only `fx_rate`. `V_i` comes from the two portfolio
 * valuations; an asset absent from one has value 0 there. An asset that is
 * `stale` or `unpriced` at either end, or has a transaction with no FX, is
 * `null` with the reason and the total is marked partial. `D ≤ 0` makes every
 * contribution `null` with `zero_start_value`.
 */
import type { IsoDate } from "@/packs/types";
import { ZERO, parseDecimal, type KDecimal } from "./decimal";
import { inWindow } from "./dates";
import { Money } from "./money";
import { groupByAsset, investedFlows } from "./positions";
import { toBase, type PortfolioInput, type PortfolioValuation } from "./portfolio";
import { hasValue, type UnpricedReason } from "./staleness";
import type { BaseFlow } from "./twr";

export type ContributionReason = UnpricedReason | "stale" | "zero_start_value";

export interface AssetContribution {
  assetId: string;
  /** Base currency; null with `reason` when undefined. */
  gain: Money | null;
  contribution: KDecimal | null;
  reason?: ContributionReason;
}

export interface ContributionResult {
  from: IsoDate;
  to: IsoDate;
  /** `V(from) + Σ flows in (from, to]`. */
  denominator: KDecimal;
  assets: readonly AssetContribution[];
  /** Σ of the defined contributions; null when `D ≤ 0`. */
  total: KDecimal | null;
  /** True when any asset is null. */
  partial: boolean;
}

export interface ContributionInput {
  input: PortfolioInput;
  from: IsoDate;
  to: IsoDate;
  start: PortfolioValuation;
  end: PortfolioValuation;
  /** External flows in base currency; only those in `(from, to]` count. */
  flows: readonly BaseFlow[];
}

type EndValue = { ok: true; value: Money } | { ok: false; reason: ContributionReason };

/** The asset's confident base value in a valuation, 0 when not held, or why not. */
function valueIn(valuation: PortfolioValuation, assetId: string, baseCurrency: string): EndValue {
  const excluded = valuation.excluded.find((e) => e.assetId === assetId);
  if (excluded) return { ok: false, reason: excluded.status === "unpriced" ? excluded.reason : "stale" };
  const row = valuation.holdings.find((h) => h.assetId === assetId);
  return { ok: true, value: row ? row.marketValueBase : Money.zero(baseCurrency) };
}

export function contribution({ input, from, to, start, end, flows }: ContributionInput): ContributionResult {
  const base = input.baseCurrency;
  let denominator = start.totalBase.amount;
  for (const flow of flows) {
    if (!inWindow(flow.date, from, to)) continue;
    denominator = denominator.plus(parseDecimal(flow.amount, "flow"));
  }
  const byAsset = groupByAsset(input.transactions);
  const zeroStart = !denominator.gt(0);

  const assets: AssetContribution[] = [];
  let total: KDecimal = ZERO;
  let partial = false;
  const undefinedFor = (assetId: string, reason: ContributionReason): void => {
    assets.push({ assetId, gain: null, contribution: null, reason });
    partial = true;
  };

  for (const asset of input.assets) {
    if (zeroStart) {
      undefinedFor(asset.id, "zero_start_value");
      continue;
    }
    const startValue = valueIn(start, asset.id, base);
    if (!startValue.ok) {
      undefinedFor(asset.id, startValue.reason);
      continue;
    }
    const endValue = valueIn(end, asset.id, base);
    if (!endValue.ok) {
      undefinedFor(asset.id, endValue.reason);
      continue;
    }

    let invested = Money.zero(base);
    let missingFx: ContributionReason | null = null;
    for (const flow of investedFlows(byAsset.get(asset.id) ?? [], from, to)) {
      const converted = toBase(input, flow.amount, flow.date, asset.packId);
      if (!hasValue(converted)) {
        missingFx = converted.status === "stale" ? "stale" : converted.reason;
        break;
      }
      invested = invested.add(converted.value);
    }
    if (missingFx !== null) {
      undefinedFor(asset.id, missingFx);
      continue;
    }
    const gain = endValue.value.sub(startValue.value).sub(invested);
    const c = gain.amount.div(denominator);
    total = total.plus(c);
    assets.push({ assetId: asset.id, gain, contribution: c });
  }

  return { from, to, denominator, assets, total: zeroStart ? null : total, partial };
}
