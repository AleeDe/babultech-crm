/**
 * What the recycle bin holds, and the permission that deletes and restores
 * each kind. Erasing for good is for administrators.
 */
export const RECYCLE_TYPES = {
  Lead: { table: "lead", permission: "lead:delete", label: "Lead", path: "/leads/", select: "firstName, lastName, companyName" },
  Account: { table: "account", permission: "account:delete", label: "Account", path: "/accounts/", select: "name" },
  Contact: { table: "contact", permission: "account:delete", label: "Contact", path: "/contacts/", select: "firstName, lastName" },
  Opportunity: { table: "opportunity", permission: "opportunity:delete", label: "Deal", path: "/opportunities/", select: "name" },
  SupportCase: { table: "support_case", permission: "case:delete", label: "Case", path: "/cases/", select: "caseNumber, subject" },
  Campaign: { table: "campaign", permission: "campaign:delete", label: "Campaign", path: "/campaigns/", select: "name" },
} as const;

export type RecycleType = keyof typeof RECYCLE_TYPES;

export function recycleLabel(type: RecycleType, row: Record<string, unknown>): string {
  const s = (k: string) => (row[k] as string | null | undefined) ?? "";
  switch (type) {
    case "Lead":
      return [`${s("firstName")} ${s("lastName")}`.trim(), s("companyName")].filter(Boolean).join(" · ");
    case "Contact":
      return `${s("firstName")} ${s("lastName")}`.trim();
    case "SupportCase":
      return `${s("caseNumber")} ${s("subject")}`.trim();
    default:
      return s("name");
  }
}
