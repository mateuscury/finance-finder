/**
 * Money — an amount in one currency (docs/milestone-2-plan.md "Arithmetic";
 * ARCHITECTURE §4.4).
 *
 * Immutable. Addition and subtraction require the same currency and throw
 * `currency_mismatch` otherwise. Multiplying by a Decimal scalar is the ONLY
 * multiplication: two Money values are never multiplied, and Money is never
 * divided by Money — a ratio of two amounts is a Decimal computed by the
 * caller from `.amount`.
 */
import type Decimal from "decimal.js";
import { KernelError } from "./errors";
import { KernelDecimal, parseDecimal, toDecimalString, type KDecimal } from "./decimal";

const CURRENCY = /^[A-Z]{3}$/;

export function assertCurrency(code: string, field = "currency"): string {
  if (!CURRENCY.test(code)) {
    throw new KernelError("invalid_currency", `${field} must be three upper-case letters`, { field });
  }
  return code;
}

export class Money {
  readonly amount: KDecimal;
  readonly currency: string;

  private constructor(amount: KDecimal, currency: string) {
    this.amount = amount;
    this.currency = currency;
    Object.freeze(this);
  }

  /** From a decimal string at the kernel boundary. */
  static parse(amount: string, currency: string, field = "amount"): Money {
    return new Money(parseDecimal(amount, field), assertCurrency(currency));
  }

  /** From a Decimal already inside the kernel. */
  static of(amount: Decimal, currency: string): Money {
    return new Money(new KernelDecimal(amount), assertCurrency(currency));
  }

  static zero(currency: string): Money {
    return new Money(new KernelDecimal(0), assertCurrency(currency));
  }

  private assertSame(other: Money, op: string): void {
    if (other.currency !== this.currency) {
      throw new KernelError("currency_mismatch", `cannot ${op} ${this.currency} and ${other.currency}`, {
        op,
        left: this.currency,
        right: other.currency,
      });
    }
  }

  add(other: Money): Money {
    this.assertSame(other, "add");
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  sub(other: Money): Money {
    this.assertSame(other, "subtract");
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  /** Money × scalar. The scalar may be a Decimal or a decimal string. */
  scale(factor: Decimal | string): Money {
    const f = typeof factor === "string" ? parseDecimal(factor, "factor") : factor;
    return new Money(this.amount.times(f), this.currency);
  }

  neg(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative() && !this.amount.isZero();
  }

  /** −1, 0 or 1. Same-currency only. */
  compare(other: Money): -1 | 0 | 1 {
    this.assertSame(other, "compare");
    return this.amount.comparedTo(other.amount) as -1 | 0 | 1;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  /** Canonical decimal string of the amount (no currency). */
  toString(): string {
    return toDecimalString(this.amount);
  }

  /** Boundary shape: both fields strings, never a number. */
  toJSON(): { amount: string; currency: string } {
    return { amount: this.toString(), currency: this.currency };
  }
}
