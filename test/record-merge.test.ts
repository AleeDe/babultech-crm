import { describe, it, expect } from "vitest";
import { companyNameKey, domainKey, taxKey } from "@/lib/record-merge";

describe("duplicate keys for accounts", () => {
  it("treats a company's legal forms and punctuation as the same name", () => {
    expect(companyNameKey("ABC (Pvt) Ltd.")).toBe("abc");
    expect(companyNameKey("abc private limited")).toBe("abc");
    expect(companyNameKey("Smith & Sons Co.")).toBe("smith sons");
    expect(companyNameKey("Smith and Sons")).toBe("smith sons");
  });

  it("keeps different companies apart", () => {
    expect(companyNameKey("Acme Logistics")).not.toBe(companyNameKey("Acme Foods"));
  });

  it("finds nothing distinctive in a name that is only a legal form", () => {
    expect(companyNameKey("Pvt Ltd")).toBeNull();
    expect(companyNameKey("")).toBeNull();
  });

  it("compares websites on their host", () => {
    expect(domainKey("https://www.example.com/about")).toBe("example.com");
    expect(domainKey("example.com")).toBe("example.com");
    expect(domainKey("http://Example.com:8080?x=1")).toBe("example.com");
    expect(domainKey("not a site")).toBeNull();
  });

  it("compares tax numbers on letters and digits", () => {
    expect(taxKey("1234567-8")).toBe("12345678");
    expect(taxKey(" 1234567 8 ")).toBe("12345678");
    expect(taxKey("12")).toBeNull();
  });
});
