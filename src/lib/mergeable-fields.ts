/**
 * The lead fields a merge may choose between.
 *
 * Mirrors the whitelist inside merge_leads(). Deliberately excludes the owner,
 * the status, the lead number and everything about conversion: a merge
 * reconciles what we know about a person, it does not reassign the work or
 * rewrite where the record had got to.
 *
 * Kept out of src/server/lead-merge.ts because that is a "use server" module,
 * and those may only export async functions - a plain const there passes tsc
 * and fails the build.
 */
export const MERGEABLE_FIELDS = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "companyName", label: "Company" },
  { key: "jobTitle", label: "Job title" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "website", label: "Website" },
  { key: "industry", label: "Industry" },
  { key: "businessType", label: "Business type" },
  { key: "companySize", label: "Company size" },
  { key: "street", label: "Street" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postalCode", label: "Postal code" },
  { key: "country", label: "Country" },
  { key: "leadSource", label: "Lead source" },
  { key: "description", label: "Notes" },
] as const;

export type MergeableFieldKey = (typeof MERGEABLE_FIELDS)[number]["key"];
