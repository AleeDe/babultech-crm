import { describe, expect, it } from "vitest";
import { analyzeLeadQuality, normalizeResearchPhone, type ResearchLead } from "@/lib/lead-quality";
const lead = (id: string, changes: Partial<ResearchLead> = {}): ResearchLead => ({ id, leadNumber: id, firstName: "Test", lastName: "Person", companyName: null, email: `${id}@example.com`, phone: null, whatsapp: null, leadSource: "Website", campaignId: null, referredByPartnerId: null, description: "Needs a stock system", nextFollowUpAt: "2026-10-01T10:00:00Z", ...changes });
describe("research quality", () => {
  it("flags missing contact, attribution, context and next action", () => {
    expect(analyzeLeadQuality([lead("a", { email: " ", leadSource: " ", description: null, nextFollowUpAt: null })])[0].issues).toEqual(["contact", "source", "brief", "followup"]);
  });
  it("accepts campaign/referral attribution without inventing a source", () => {
    expect(analyzeLeadQuality([lead("a", { leadSource: null, campaignId: "campaign" })])[0].issues).not.toContain("source");
    expect(analyzeLeadQuality([lead("b", { leadSource: null, referredByPartnerId: "partner" })])[0].issues).not.toContain("source");
  });
  it("matches email casing and phone/WhatsApp formatting across fields", () => {
    const result = analyzeLeadQuality([lead("a", { email: " PERSON@example.com ", phone: "+92 (300) 123-4567" }), lead("b", { email: "person@example.com" }), lead("c", { whatsapp: "+923001234567" })]);
    expect(result[0].duplicateIds).toEqual(["b", "c"]);
    expect(result[1].duplicateIds).toEqual(["a"]);
  });
  it("does not guess local country codes, match names, or self-match repeated channels", () => {
    const result = analyzeLeadQuality([lead("a", { phone: "03001234567", whatsapp: "0300-1234567" }), lead("b", { phone: "+923001234567" })]);
    expect(result.every(row => row.duplicateCount === 0)).toBe(true);
  });
  it("flags malformed values even when another channel is present", () => {
    expect(analyzeLeadQuality([lead("a", { phone: "call me later" })])[0].issues).toContain("contact");
    expect(normalizeResearchPhone("123")).toBeNull();
    expect(normalizeResearchPhone("123456789 ext 42")).toBeNull();
  });
  it("limits match links while retaining the full candidate count", () => {
    const result = analyzeLeadQuality(Array.from({ length: 14 }, (_, index) => lead(String(index), { email: "shared@example.com" })));
    expect(result[0].duplicateCount).toBe(13); expect(result[0].duplicateIds).toHaveLength(10);
  });
  it("leaves complete records clean and does not mutate input", () => {
    const input = lead("a"); const copy = JSON.stringify(input);
    expect(analyzeLeadQuality([input])[0].issues).toEqual([]);
    expect(JSON.stringify(input)).toBe(copy);
  });
});
