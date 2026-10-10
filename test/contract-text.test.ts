import { describe, expect, it } from "vitest";
import { boldParts } from "@/lib/contract-format";

describe("contract formatting", () => {
  it("finds **words** to show in bold", () => {
    expect(boldParts("Pay is **PKR 40,000** a month.")).toEqual([
      { text: "Pay is ", bold: false },
      { text: "PKR 40,000", bold: true },
      { text: " a month.", bold: false },
    ]);
  });

  it("leaves stray asterisks as they are", () => {
    expect(boldParts("2 * 3 = 6 and a ** b")).toEqual([{ text: "2 * 3 = 6 and a ** b", bold: false }]);
    expect(boldParts("****")).toEqual([{ text: "****", bold: false }]);
  });

  it("keeps markup as text, to be rendered as text", () => {
    expect(boldParts("**<script>x</script>**")).toEqual([{ text: "<script>x</script>", bold: true }]);
  });

  it("handles several bold runs and line breaks", () => {
    expect(boldParts("**A** and **B**\nnext").filter((p) => p.bold).map((p) => p.text)).toEqual(["A", "B"]);
  });
});
