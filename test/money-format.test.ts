/**
 * USD beside totals only.
 *
 * Every amount shows its own currency; the reference conversion - the
 * "(≈ USD 17.99)" - is kept for totals: a record's total, the summary tiles at
 * the top of a list, and a dashboard's headline figures. These pin the two
 * formats apart, so a price or a line can never pick the conversion back up by
 * accident.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatMoney, formatMoneyTotal, formatCompactMoney, formatCompactMoneyTotal,
} from "@/lib/utils";
import { setCurrencyContext } from "@/lib/currency-context";

beforeEach(() => {
  // 1 USD buys 278 PKR; rates are how much PKR one unit buys.
  setCurrencyContext({ defaultCurrency: "PKR", corporateCurrency: "USD", rates: { PKR: 1, USD: 278 } });
});

afterEach(() => setCurrencyContext(null));

describe("an ordinary amount", () => {
  it("shows its own currency only", () => {
    expect(formatMoney(5000)).toMatch(/^PKR\s5,000\.00$/);
    expect(formatMoney(5000)).not.toContain("≈");
  });

  it("stays one currency in compact form too", () => {
    expect(formatCompactMoney(1_250_000)).toMatch(/^PKR\s1\.3M$/);
    expect(formatCompactMoney(1_250_000)).not.toContain("USD");
  });
});

describe("a total", () => {
  it("carries the USD reference beside it", () => {
    expect(formatMoneyTotal(5000)).toMatch(/^PKR\s5,000\.00 \(≈ USD\s17\.99\)$/);
  });

  it("does so in compact form too", () => {
    expect(formatCompactMoneyTotal(1_250_000)).toMatch(/^PKR\s1\.3M \(≈ USD\s4\.5K\)$/);
  });

  it("shows PKR beside a total that is already in USD", () => {
    expect(formatMoneyTotal(100, "USD")).toMatch(/^USD\s100\.00 \(≈ PKR\s27,800\.00\)$/);
  });

  it("shows one currency when no rate is known, rather than a guess", () => {
    setCurrencyContext({ defaultCurrency: "PKR", corporateCurrency: "USD", rates: { PKR: 1 } });
    expect(formatMoneyTotal(5000)).toMatch(/^PKR\s5,000\.00$/);
  });
});
