import { describe, expect, it } from "vitest";
import { optionKey, similarOption, priceBasis } from "@/lib/product-options";

describe("catalogue options", () => {
  it("normalizes casing, spacing, punctuation and licence spelling", () => {
    expect(optionKey(" Soft-Ware ")).toBe(optionKey("software"));
    expect(optionKey("License")).toBe(optionKey("Licence"));
  });
  it.each([["Software", "Softwre"], ["User", "Users"], ["Consulting", "Consultng"]])("suggests %s for %s", (a, b) => {
    expect(similarOption(a, b)).toBe(true);
  });
  it.each([["Hardware", "Software"], ["Day", "Year"], ["Hosting", "Training"]])("allows distinct options %s and %s", (a, b) => {
    expect(similarOption(a, b)).toBe(false);
  });
});

describe("product pricing basis", () => {
  it("combines selling unit and monthly period", () => expect(priceBasis("MONTHLY", "User")).toBe("per user, per month"));
  it("does not repeat matching time units", () => expect(priceBasis("MONTHLY", "Month")).toBe("per month"));
  it("describes annual and hourly pricing", () => {
    expect(priceBasis("ANNUAL", "Licence")).toBe("per licence, per year");
    expect(priceBasis("HOURLY", "Hour")).toBe("per hour");
  });
  it("distinguishes fixed prices from unspecified retainer periods", () => {
    expect(priceBasis("FIXED", "Device")).toBe("per device, one-time");
    expect(priceBasis("RETAINER")).toBe("per unit, per agreed retainer period");
  });
});
