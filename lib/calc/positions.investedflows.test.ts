import { describe, expect, it } from "vitest";
import { investedFlows, netInvested } from "./positions";
import type { LedgerTransaction } from "./types";

const t = (id: string, tradeDate: string, type: LedgerTransaction["type"], quantity: string, unitPrice: string, fees = "0", currency = "BRL"): LedgerTransaction => ({
  id,
  assetId: "a",
  tradeDate,
  type,
  quantity,
  unitPrice,
  currency,
  fees,
  fxRate: null,
});

describe("investedFlows", () => {
  it("one signed entry per transaction in (from, to], in ledger order; netInvested is their sum", () => {
    const rows = [
      t("sell", "2026-02-12", "sell", "-2", "12", "1"),
      t("buy", "2026-02-11", "buy", "10", "10", "2"),
      t("div", "2026-02-12", "dividend", "0", "7"),
      t("fee", "2026-02-13", "fee", "0", "3"),
      t("early", "2026-02-10", "buy", "1", "1"),
      t("late", "2026-02-14", "buy", "1", "1"),
    ];
    const flows = investedFlows(rows, "2026-02-10", "2026-02-13");
    expect(flows.map((f) => [f.transactionId, f.date, f.amount.toString()])).toEqual([
      ["buy", "2026-02-11", "102"],
      ["div", "2026-02-12", "-7"],
      ["sell", "2026-02-12", "-23"],
      ["fee", "2026-02-13", "3"],
    ]);
    expect(netInvested(rows, "BRL", "2026-02-10", "2026-02-13").toString()).toBe("75");
    expect(() => netInvested([t("x", "2026-02-11", "buy", "1", "1", "0", "USD")], "BRL", "2026-02-10", "2026-02-13")).toThrow(/currency_mismatch/);
  });
});
