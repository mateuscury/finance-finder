import { describe, expect, it } from "vitest";
import { KernelError, isKernelError } from "./errors";

describe("KernelError", () => {
  it("prefixes the message with the code and names itself", () => {
    const err = new KernelError("oversell", "sell exceeds open quantity", { assetId: "a1", date: "2026-02-10" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("KernelError");
    expect(err.code).toBe("oversell");
    expect(err.message).toBe("oversell: sell exceeds open quantity");
    expect(err.details).toEqual({ assetId: "a1", date: "2026-02-10" });
  });

  it("freezes details and copies them, so a caller's later mutation cannot leak in", () => {
    const details: Record<string, string> = { field: "price" };
    const err = new KernelError("invalid_decimal", "not a decimal", details);
    details.field = "changed";
    expect(err.details).toEqual({ field: "price" });
    expect(Object.isFrozen(err.details)).toBe(true);
    expect(() => {
      (err.details as Record<string, string>).field = "x";
    }).toThrow();
  });

  it("defaults details to an empty frozen object", () => {
    const err = new KernelError("invalid_input", "bad row");
    expect(err.details).toEqual({});
    expect(Object.isFrozen(err.details)).toBe(true);
  });

  it("isKernelError narrows by instance and optionally by code", () => {
    const err = new KernelError("currency_mismatch", "BRL vs USD");
    expect(isKernelError(err)).toBe(true);
    expect(isKernelError(err, "currency_mismatch")).toBe(true);
    expect(isKernelError(err, "oversell")).toBe(false);
    expect(isKernelError(new Error("currency_mismatch: BRL vs USD"))).toBe(false);
    expect(isKernelError(null)).toBe(false);
    expect(isKernelError("currency_mismatch")).toBe(false);
  });
});
