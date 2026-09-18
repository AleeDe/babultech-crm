export const qualityLabels = {
  contact: "Contact details need review", duplicate: "Possible duplicate", source: "Missing source",
  brief: "Missing research brief", followup: "Missing next action",
} as const;
export type QualityIssue = keyof typeof qualityLabels;
export type ResearchLead = {
  id: string; leadNumber: string; firstName: string; lastName: string; companyName: string | null;
  email: string | null; phone: string | null; whatsapp: string | null; leadSource: string | null;
  campaignId: string | null; referredByPartnerId: string | null; description: string | null;
  nextFollowUpAt: string | null;
};
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function contactKeys(lead: ResearchLead): string[] {
  const keys = new Set<string>();
  const email = lead.email?.trim().toLowerCase();
  if (email && emailPattern.test(email)) keys.add(`email:${email}`);
  for (const value of [lead.phone, lead.whatsapp]) {
    const phone = normalizeResearchPhone(value);
    if (phone) keys.add(`phone:${phone}`);
  }
  return [...keys];
}
export function normalizeResearchPhone(value: string | null): string | null {
  const raw = value?.trim();
  if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) return null;
  // Formatting only: never guess a country code, strip a local prefix, or merge extensions.
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}
export function analyzeLeadQuality(leads: ResearchLead[]) {
  const index = new Map<string, Set<string>>();
  for (const lead of leads) for (const key of contactKeys(lead)) {
    const ids = index.get(key) ?? new Set<string>(); ids.add(lead.id); index.set(key, ids);
  }
  return leads.map(lead => {
    const issues: QualityIssue[] = [];
    const email = lead.email?.trim();
    const phones = [lead.phone, lead.whatsapp].filter(value => value?.trim());
    if ((!email && !phones.length) || (email && !emailPattern.test(email)) || phones.some(value => !normalizeResearchPhone(value))) issues.push("contact");
    const duplicateIds = new Set<string>();
    for (const key of contactKeys(lead)) for (const id of index.get(key) ?? []) if (id !== lead.id) duplicateIds.add(id);
    if (duplicateIds.size) issues.push("duplicate");
    if (!lead.leadSource?.trim() && !lead.campaignId && !lead.referredByPartnerId) issues.push("source");
    if (!lead.description?.trim()) issues.push("brief");
    if (!lead.nextFollowUpAt) issues.push("followup");
    return { lead, issues, duplicateIds: [...duplicateIds].slice(0, 10), duplicateCount: duplicateIds.size };
  });
}
