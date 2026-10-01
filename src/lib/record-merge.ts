/**
 * Merging duplicate contacts and accounts: the fields a merge may choose
 * between, and the keys duplicates are found by.
 *
 * The field lists mirror the whitelists inside merge_contacts() and
 * merge_accounts() (20261001000000_record_merge.sql). Kept out of
 * server/record-merge.ts because a "use server" module may only export async
 * functions.
 */

export type MergeEntity = "contact" | "account";

export const MERGE_FIELDS: Record<MergeEntity, { key: string; label: string }[]> = {
  contact: [
    { key: "firstName", label: "First name" },
    { key: "lastName", label: "Last name" },
    { key: "accountId", label: "Account" },
    { key: "jobTitle", label: "Job title" },
    { key: "department", label: "Department" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "mobile", label: "Mobile" },
    { key: "whatsapp", label: "WhatsApp" },
    { key: "contactRole", label: "Role on account" },
  ],
  account: [
    { key: "name", label: "Name" },
    { key: "industry", label: "Industry" },
    { key: "website", label: "Website" },
    { key: "mainPhone", label: "Phone" },
    { key: "taxNumberNtn", label: "Tax / NTN" },
    { key: "employeeCount", label: "Employees" },
    { key: "annualRevenue", label: "Annual revenue" },
    { key: "creditLimit", label: "Credit limit" },
    { key: "paymentTermsDays", label: "Payment terms (days)" },
    { key: "description", label: "Description" },
  ],
};

export const MERGE_NOUN: Record<MergeEntity, { one: string; many: string; path: string }> = {
  contact: { one: "contact", many: "contacts", path: "/contacts" },
  account: { one: "account", many: "accounts", path: "/accounts" },
};

export interface MergeCandidate {
  id: string;
  title: string;
  subtitle: string;
  createdAt: string;
  /** Raw values, as the merge sends them. */
  values: Record<string, string>;
  /** How a value reads on screen, where that differs (an account id shows its name). */
  display: Record<string, string>;
  /** How many of the merge fields are filled in. Decides the suggested record to keep. */
  completeness: number;
  /** Why this record could not be merged away, when there is a reason. */
  keepOnly?: string;
}

export interface CandidateGroup {
  matchedOn: string;
  records: MergeCandidate[];
}

const COMPANY_SUFFIXES = new Set([
  "ltd", "limited", "pvt", "private", "inc", "incorporated", "llc", "llp", "plc", "co", "company", "corp",
  "corporation", "gmbh", "sa", "smc", "the", "and",
]);

/**
 * A company name as duplicates are compared: lower-case, punctuation gone, and
 * the legal form dropped - "ABC (Pvt) Ltd." and "abc private limited" are one
 * company. Null when nothing distinctive is left.
 */
export function companyNameKey(name: string | null | undefined): string | null {
  const words = (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !COMPANY_SUFFIXES.has(w));
  const key = words.join(" ");
  return key.length >= 2 ? key : null;
}

/** A website as duplicates are compared: the host, without "www.". */
export function domainKey(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim().toLowerCase();
  if (!raw) return null;
  const host = raw.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0].replace(/^www\./, "");
  return host.includes(".") ? host : null;
}

/** A tax number as compared: letters and digits only. */
export function taxKey(value: string | null | undefined): string | null {
  const key = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return key.length >= 5 ? key : null;
}
