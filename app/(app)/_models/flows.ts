/**
 * The ledger's external cash flows in the base currency, for TWR, MWR and
 * contribution (MILESTONES.md §2 decision 16; §4 decision 54). A flow in
 * the base currency maps directly. A flow in another currency — unreachable
 * from the forms (decision 25) but possible in a restored file — is
 * converted with the kernel's `toBase` at its own date under the first
 * holdable pack's window; one that cannot be converted is dropped and
 * counted so the screen can say the figure is partial.
 */
import type { BaseFlow } from "@/lib/calc/twr";
import { Money } from "@/lib/calc/money";
import { toBase, type PortfolioInput } from "@/lib/calc/portfolio";
import type { LedgerRead } from "@/lib/ledger/rows";
import { hasValue } from "@/lib/calc/staleness";

export function baseFlowsOf(read: LedgerRead, input: PortfolioInput): { flows: BaseFlow[]; dropped: number } {
  const packId = read.packs.find((p) => p.instruments.length > 0)?.id ?? read.packs[0]?.id ?? null;
  const flows: BaseFlow[] = [];
  let dropped = 0;
  for (const f of read.cashFlows) {
    if (f.currency === input.baseCurrency) {
      flows.push({ date: f.date, amount: f.amount });
      continue;
    }
    if (packId === null) {
      dropped += 1;
      continue;
    }
    const converted = toBase(input, Money.parse(f.amount, f.currency), f.date, packId);
    if (hasValue(converted)) flows.push({ date: f.date, amount: converted.value.amount.toString() });
    else dropped += 1;
  }
  return { flows, dropped };
}
