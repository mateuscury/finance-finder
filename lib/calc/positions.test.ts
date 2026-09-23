import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ZERO } from "./decimal";
import { isKernelError } from "./errors";
import { averageCost, lotQuantity, lotsAt, netInvested, openCost, quantityAt, sortLedger } from "./positions";
import type { LedgerTransaction, TransactionType } from "./types";
import { addDays } from "./dates";

let seq = 0;
function txn(
  overrides: Partial<LedgerTransaction> & {
    type: TransactionType;
    quantity: string;
    unitPrice: string;
    tradeDate: string;
  },
): LedgerTransaction {
  seq += 1;
  return {
    id: `t${String(seq).padStart(4, "0")}`,
    assetId: "a1",
    currency: "BRL",
    fees: "0",
    fxRate: null,
    ...overrides,
  };
}

const lotsAsStrings = (
  lots: readonly { openedOn: string; quantity: { toFixed(): string }; unitPrice: { toFixed(): string } }[],
) => lots.map((l) => [l.openedOn, l.quantity.toFixed(), l.unitPrice.toFixed()]);

describe("ordering", () => {
  it("processes buy < dividend = interest = fee < sell on the same day, then by id", () => {
    const sell = txn({ id: "a", type: "sell", quantity: "-10", unitPrice: "12", tradeDate: "2026-03-02" });
    const buy = txn({ id: "b", type: "buy", quantity: "10", unitPrice: "10", tradeDate: "2026-03-02" });
    const div = txn({ id: "c", type: "dividend", quantity: "0", unitPrice: "1", tradeDate: "2026-03-02" });
    expect(sortLedger([sell, div, buy]).map((t) => t.id)).toEqual(["b", "c", "a"]);
    // A same-day round trip never oversells, even with the sell's id sorting first.
    expect(lotsAt([sell, buy], "2026-03-02")).toEqual([]);
  });

  it("sortLedger does not mutate the input", () => {
    const rows = [
      txn({ type: "buy", quantity: "1", unitPrice: "1", tradeDate: "2026-03-01" }),
      txn({ type: "buy", quantity: "1", unitPrice: "1", tradeDate: "2026-01-01" }),
    ];
    const snapshot = rows.map((r) => r.id);
    expect(sortLedger(rows).map((t) => t.tradeDate)).toEqual(["2026-01-01", "2026-03-01"]);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});

describe("lotsAt", () => {
  it("opens lots on buys, consumes FIFO on sells, ignores the rest", () => {
    const rows = [
      txn({ type: "buy", quantity: "10", unitPrice: "100", tradeDate: "2026-01-05" }),
      txn({ type: "buy", quantity: "5", unitPrice: "110", tradeDate: "2026-01-06" }),
      txn({ type: "dividend", quantity: "0", unitPrice: "7.5", tradeDate: "2026-01-07" }),
      txn({ type: "sell", quantity: "-12", unitPrice: "120", tradeDate: "2026-01-08" }),
    ];
    expect(lotsAsStrings(lotsAt(rows, "2026-01-04"))).toEqual([]);
    expect(lotsAsStrings(lotsAt(rows, "2026-01-05"))).toEqual([["2026-01-05", "10", "100"]]);
    expect(lotsAsStrings(lotsAt(rows, "2026-01-07"))).toEqual([
      ["2026-01-05", "10", "100"],
      ["2026-01-06", "5", "110"],
    ]);
    // 12 sold: the whole first lot (10) and 2 of the second.
    expect(lotsAsStrings(lotsAt(rows, "2026-01-08"))).toEqual([["2026-01-06", "3", "110"]]);
    expect(quantityAt(rows, "2026-01-08").toFixed()).toBe("3");
    expect(quantityAt(rows, "2026-01-07").toFixed()).toBe("15");
  });

  it("throws oversell with the asset id and date, never a negative position", () => {
    const rows = [
      txn({ type: "buy", quantity: "10", unitPrice: "100", tradeDate: "2026-01-05" }),
      txn({ type: "sell", quantity: "-10.0001", unitPrice: "120", tradeDate: "2026-01-08" }),
    ];
    try {
      lotsAt(rows, "2026-12-31");
      expect.unreachable();
    } catch (err) {
      expect(isKernelError(err, "oversell")).toBe(true);
      const details = (err as { details: Record<string, unknown> }).details;
      expect(details.assetId).toBe("a1");
      expect(details.date).toBe("2026-01-08");
      expect(JSON.stringify(details)).not.toContain("10.0001");
    }
    // Before the sell it is fine.
    expect(quantityAt(rows, "2026-01-07").toFixed()).toBe("10");
  });

  it("validates shape like the ledger's check constraints", () => {
    expect(() =>
      lotsAt([txn({ type: "buy", quantity: "-1", unitPrice: "1", tradeDate: "2026-01-01" })], "2026-12-31"),
    ).toThrow();
    expect(() =>
      lotsAt([txn({ type: "sell", quantity: "1", unitPrice: "1", tradeDate: "2026-01-01" })], "2026-12-31"),
    ).toThrow();
    expect(() =>
      lotsAt([txn({ type: "fee", quantity: "1", unitPrice: "1", tradeDate: "2026-01-01" })], "2026-12-31"),
    ).toThrow();
    expect(() =>
      lotsAt([txn({ type: "buy", quantity: "1", unitPrice: "0", tradeDate: "2026-01-01" })], "2026-12-31"),
    ).toThrow();
    expect(() =>
      lotsAt([txn({ type: "buy", quantity: "1", unitPrice: "1", fees: "-1", tradeDate: "2026-01-01" })], "2026-12-31"),
    ).toThrow();
    expect(() =>
      lotsAt([txn({ type: "buy", quantity: "1e2", unitPrice: "1", tradeDate: "2026-01-01" })], "2026-12-31"),
    ).toThrow();
    expect(() =>
      lotsAt(
        [
          txn({ assetId: "a", type: "buy", quantity: "1", unitPrice: "1", tradeDate: "2026-01-01" }),
          txn({ assetId: "b", type: "buy", quantity: "1", unitPrice: "1", tradeDate: "2026-01-01" }),
        ],
        "2026-12-31",
      ),
    ).toThrow();
  });
});

/**
 * A valid ledger: a sequence of buys and sells where no sell exceeds the
 * running position. Dates and ids increase with position, so processing
 * order equals generation order; the INPUT array is then shuffled.
 */
const validLedger = fc
  .array(fc.tuple(fc.boolean(), fc.integer({ min: 1, max: 20 })), { minLength: 0, maxLength: 30 })
  .map((ops) => {
    const rows: LedgerTransaction[] = [];
    let running = 0;
    ops.forEach(([isBuy, q], i) => {
      const date = addDays("2026-01-01", i);
      const id = `p${String(i).padStart(3, "0")}`;
      if (isBuy || running === 0) {
        rows.push({
          id,
          assetId: "a1",
          tradeDate: date,
          type: "buy",
          quantity: String(q),
          unitPrice: String(100 + i),
          currency: "BRL",
          fees: "0",
          fxRate: null,
        });
        running += q;
      } else {
        const sell = q > running ? running : q;
        rows.push({
          id,
          assetId: "a1",
          tradeDate: date,
          type: "sell",
          quantity: String(-sell),
          unitPrice: String(100 + i),
          currency: "BRL",
          fees: "0",
          fxRate: null,
        });
        running -= sell;
      }
    });
    return rows;
  });

describe("properties", () => {
  it("positions are independent of input order", () => {
    fc.assert(
      fc.property(
        validLedger.chain((rows) => fc.tuple(fc.constant(rows), fc.shuffledSubarray(rows, { minLength: rows.length }))),
        ([rows, shuffled]) => {
          expect(lotsAsStrings(lotsAt(shuffled, "2026-12-31"))).toEqual(lotsAsStrings(lotsAt(rows, "2026-12-31")));
        },
      ),
    );
  });

  it("FIFO leaves Σ lots === Σ signed quantity", () => {
    fc.assert(
      fc.property(validLedger, (rows) => {
        const signed = rows.reduce((s, t) => s + parseInt(t.quantity, 10), 0);
        expect(quantityAt(rows, "2026-12-31").toFixed()).toBe(String(signed));
        // Every open lot is positive and lots are in FIFO (date) order.
        const lots = lotsAt(rows, "2026-12-31");
        lots.forEach((l, i) => {
          expect(l.quantity.gt(0)).toBe(true);
          if (i > 0) expect(l.openedOn >= lots[i - 1].openedOn).toBe(true);
        });
      }),
    );
  });

  it("oversell always throws", () => {
    fc.assert(
      fc.property(validLedger, fc.integer({ min: 1, max: 5 }), (rows, extra) => {
        const total = rows.reduce((s, t) => s + parseInt(t.quantity, 10), 0);
        const oversell: LedgerTransaction = {
          id: "zzz",
          assetId: "a1",
          tradeDate: "2026-06-30",
          type: "sell",
          quantity: String(-(total + extra)),
          unitPrice: "1",
          currency: "BRL",
          fees: "0",
          fxRate: null,
        };
        let code: string | null = null;
        try {
          lotsAt([...rows, oversell], "2026-12-31");
        } catch (err) {
          code = isKernelError(err) ? err.code : "other";
        }
        expect(code).toBe("oversell");
      }),
    );
  });
});

describe("openCost / averageCost", () => {
  it("is the FIFO remainder's cost, before fees (SPEC §6; decision 59)", () => {
    const rows = [
      txn({ type: "buy", quantity: "10", unitPrice: "100", fees: "7", tradeDate: "2026-01-05" }),
      txn({ type: "buy", quantity: "10", unitPrice: "120", fees: "7", tradeDate: "2026-01-06" }),
      txn({ type: "sell", quantity: "-5", unitPrice: "200", fees: "7", tradeDate: "2026-01-07" }),
    ];
    // FIFO leaves 5 @ 100 and 10 @ 120 → 500 + 1200 = 1700 over 15 units.
    const lots = lotsAt(rows, "2026-12-31");
    expect(openCost(lots, "BRL").toString()).toBe("1700");
    expect(averageCost(lots)?.toFixed(10)).toBe("113.3333333333");
    // The 21 in fees is nowhere in either figure — that is the whole point.
    expect(openCost(lots, "BRL").toString()).not.toContain("21");
  });

  it("is zero and null once the position is fully sold", () => {
    const rows = [
      txn({ type: "buy", quantity: "10", unitPrice: "100", tradeDate: "2026-01-05" }),
      txn({ type: "sell", quantity: "-10", unitPrice: "150", tradeDate: "2026-01-06" }),
    ];
    const lots = lotsAt(rows, "2026-12-31");
    expect(openCost(lots, "BRL").toString()).toBe("0");
    expect(averageCost(lots)).toBeNull();
    expect(averageCost([])).toBeNull();
  });

  it("throws currency_mismatch on a lot in another currency — averageCost too", () => {
    const lots = lotsAt(
      [txn({ type: "buy", quantity: "1", unitPrice: "1", currency: "USD", tradeDate: "2026-01-06" })],
      "2026-12-31",
    );
    try {
      openCost(lots, "BRL");
      expect.unreachable();
    } catch (err) {
      expect(isKernelError(err, "currency_mismatch")).toBe(true);
    }
    // Mixed lots must not average into a blended number that means nothing.
    const mixed = lotsAt(
      [
        txn({ type: "buy", quantity: "1", unitPrice: "1", currency: "BRL", tradeDate: "2026-01-05" }),
        txn({ type: "buy", quantity: "1", unitPrice: "1", currency: "USD", tradeDate: "2026-01-06" }),
      ],
      "2026-12-31",
    );
    try {
      averageCost(mixed);
      expect.unreachable();
    } catch (err) {
      expect(isKernelError(err, "currency_mismatch")).toBe(true);
    }
  });

  it("property: openCost === Σ quantity × unitPrice over the open lots, and averageCost × quantity === openCost", () => {
    fc.assert(
      fc.property(validLedger, (rows) => {
        const lots = lotsAt(rows, "2026-12-31");
        // Summed independently of the implementation, in the test's own arithmetic.
        const expected = lots.reduce((sum, l) => sum.plus(l.quantity.times(l.unitPrice)), ZERO);
        expect(openCost(lots, "BRL").amount.equals(expected)).toBe(true);
        const average = averageCost(lots);
        if (average === null) expect(lotQuantity(lots).isZero()).toBe(true);
        else expect(average.times(lotQuantity(lots)).minus(expected).abs().lt("1e-20")).toBe(true);
      }),
    );
  });
});

describe("netInvested", () => {
  it("adds buy cost and fees, subtracts sell proceeds net of fees and income, adds fee rows, over (from, to]", () => {
    const rows = [
      txn({ type: "buy", quantity: "10", unitPrice: "100", fees: "5", tradeDate: "2026-01-05" }), // +1005 (excluded: on `from`)
      txn({ type: "buy", quantity: "10", unitPrice: "100", fees: "5", tradeDate: "2026-01-06" }), // +1005
      txn({ type: "sell", quantity: "-4", unitPrice: "120", fees: "2", tradeDate: "2026-01-07" }), // −(480 − 2) = −478
      txn({ type: "dividend", quantity: "0", unitPrice: "30", tradeDate: "2026-01-08" }), // −30
      txn({ type: "interest", quantity: "0", unitPrice: "1.5", tradeDate: "2026-01-08" }), // −1.5
      txn({ type: "fee", quantity: "0", unitPrice: "9", tradeDate: "2026-01-09" }), // +9
      txn({ type: "buy", quantity: "1", unitPrice: "1", tradeDate: "2026-01-10" }), // excluded: after `to`
    ];
    const m = netInvested(rows, "BRL", "2026-01-05", "2026-01-09");
    expect(m.currency).toBe("BRL");
    expect(m.toString()).toBe("504.5"); // 1005 − 478 − 30 − 1.5 + 9
    expect(netInvested([], "BRL", "2026-01-01", "2026-12-31").toString()).toBe("0");
  });

  it("throws currency_mismatch on a row in another currency", () => {
    const rows = [txn({ type: "buy", quantity: "1", unitPrice: "1", currency: "USD", tradeDate: "2026-01-06" })];
    try {
      netInvested(rows, "BRL", "2026-01-01", "2026-12-31");
      expect.unreachable();
    } catch (err) {
      expect(isKernelError(err, "currency_mismatch")).toBe(true);
    }
  });
});
