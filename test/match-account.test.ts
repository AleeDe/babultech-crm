/**
 * Duplicate-account detection.
 *
 * The bias under test is conservatism: a false positive invites someone to
 * attach a lead to the wrong company, which is quieter and more damaging than
 * the duplicate it was trying to prevent. So the "should not match" cases matter
 * more here than the ones that should.
 */
import { describe, it, expect } from "vitest";
import { normaliseCompany, findAccountMatches } from "@/lib/match-account";

describe("normaliseCompany", () => {
  it("drops a legal suffix", () => {
    expect(normaliseCompany("Sultana Medical, Inc")).toBe("sultana medical");
    expect(normaliseCompany("Rehman Foods Ltd")).toBe("rehman foods");
    expect(normaliseCompany("Acme Pvt Limited")).toBe("acme");
  });

  it("ignores case, punctuation and spacing", () => {
    expect(normaliseCompany("SULTANA  MEDICAL")).toBe("sultana medical");
    expect(normaliseCompany("Sultana-Medical")).toBe("sultana medical");
  });

  it("treats & and 'and' the same", () => {
    // Both drop the connector, so the two spellings converge.
    expect(normaliseCompany("Smith & Sons")).toBe(normaliseCompany("Smith and Sons"));
  });

  it("keeps a suffix word that is part of the name", () => {
    // "group" only lacks meaning where a legal form would sit — at the end.
    expect(normaliseCompany("Group Therapy Ltd")).toBe("group therapy");
  });

  it("never strips a name down to nothing", () => {
    // A company literally called "Limited" keeps its only word.
    expect(normaliseCompany("Limited")).toBe("limited");
  });
});

describe("findAccountMatches", () => {
  const accounts = [
    { id: "1", name: "Sultana Medical, Inc" },
    { id: "2", name: "Rehman Foods" },
    { id: "3", name: "City Hospital" },
    { id: "4", name: "Mehmood Motors Ltd" },
  ];

  it("matches the same company written differently", () => {
    const m = findAccountMatches("Sultana Medical", accounts);
    expect(m).toHaveLength(1);
    expect(m[0].account.id).toBe("1");
    expect(m[0].confidence).toBe("exact");
  });

  it("matches when the legal form differs", () => {
    expect(findAccountMatches("Mehmood Motors", accounts)[0]?.account.id).toBe("4");
  });

  it("matches a longer name containing the account's", () => {
    const m = findAccountMatches("Sultana Medical Centre", accounts);
    expect(m[0]?.account.id).toBe("1");
    expect(m[0]?.confidence).toBe("close");
  });

  it("returns nothing for a genuinely different company", () => {
    expect(findAccountMatches("Noor Textiles", accounts)).toEqual([]);
  });

  it("does not match on a shared word", () => {
    // "Hospital" appears in an account name, but a lead at "General Hospital"
    // is not necessarily City Hospital — matching here would be a guess.
    expect(findAccountMatches("General Hospital", accounts)).toEqual([]);
  });

  it("does not match a fragment of a word", () => {
    // "Medi" must not pull in "Sultana Medical".
    expect(findAccountMatches("Medi", accounts)).toEqual([]);
  });

  it("ignores names too short to be evidence", () => {
    // Below four characters, containment is coincidence.
    expect(findAccountMatches("ABC", accounts)).toEqual([]);
  });

  it("returns nothing when the lead has no company", () => {
    expect(findAccountMatches(null, accounts)).toEqual([]);
    expect(findAccountMatches("", accounts)).toEqual([]);
  });

  it("puts exact matches before close ones", () => {
    const withBoth = [...accounts, { id: "5", name: "Sultana Medical Group Holdings" }];
    const m = findAccountMatches("Sultana Medical", withBoth);
    expect(m[0].confidence).toBe("exact");
    expect(m.length).toBeGreaterThan(1);
  });
});
