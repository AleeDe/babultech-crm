/**
 * What the recycle bin holds. Deleting, restoring and erasing are the Super
 * Admin's alone (record:delete), for every kind, whatever the record's status
 * or stage; only the books hold a delete back (recycle_hard_blocker()).
 *
 * `opensWhenDeleted` marks the kinds whose own page still opens once deleted
 * (and offers Restore there); the others are restored from the recycle bin.
 * Why a record cannot be deleted is recycle_blocker() in the database
 * (20261004000001_recycle_bin_more_types.sql).
 *
 * `serviceOnly` marks tables the browser's session cannot read at all (HR,
 * which holds pay); the recycle bin reads those with the service role after
 * checking the permission, which for them is always admin:*.
 */
export const RECYCLE_TYPES = {
  Lead: { table: "lead", permission: "record:delete", label: "Lead", path: "/leads/", select: "firstName, lastName, companyName", opensWhenDeleted: true },
  Account: { table: "account", permission: "record:delete", label: "Account", path: "/accounts/", select: "name", opensWhenDeleted: true },
  Contact: { table: "contact", permission: "record:delete", label: "Contact", path: "/contacts/", select: "firstName, lastName", opensWhenDeleted: true },
  Opportunity: { table: "opportunity", permission: "record:delete", label: "Deal", path: "/opportunities/", select: "name", opensWhenDeleted: true },
  SupportCase: { table: "support_case", permission: "record:delete", label: "Case", path: "/cases/", select: "caseNumber, subject", opensWhenDeleted: true },
  Campaign: { table: "campaign", permission: "record:delete", label: "Campaign", path: "/campaigns/", select: "name", opensWhenDeleted: true },
  Quotation: { table: "quotation", permission: "record:delete", label: "Quote", path: "/quotations/", select: "quoteNumber", opensWhenDeleted: false },
  Contract: { table: "contract", permission: "record:delete", label: "Contract", path: "/contracts/", select: "contractNumber, name", opensWhenDeleted: false },
  Project: { table: "project", permission: "record:delete", label: "Project", path: "/projects/", select: "projectNumber, name", opensWhenDeleted: false },
  Product: { table: "product", permission: "record:delete", label: "Product or service", path: "/products/", select: "name", opensWhenDeleted: false },
  PriceBook: { table: "price_book", permission: "record:delete", label: "Price book", path: "/price-books/", select: "name", opensWhenDeleted: false },
  Partner: { table: "partner", permission: "record:delete", label: "Partner", path: "/partners/", select: "partnerNumber, displayName", opensWhenDeleted: false },
  KnowledgeArticle: { table: "knowledge_article", permission: "record:delete", label: "Help article", path: "/knowledge/", select: "articleNumber, title", opensWhenDeleted: false },
  CampaignMember: { table: "campaign_member", permission: "record:delete", label: "Campaign member", path: "/campaign-members/", select: "firstName, lastName", opensWhenDeleted: false },
  Activity: { table: "activity", permission: "record:delete", label: "Activity", path: "/activities/", select: "subject", opensWhenDeleted: false },
  Invoice: { table: "invoice", permission: "record:delete", label: "Invoice", path: "/invoices/", select: "invoiceNumber", opensWhenDeleted: false },
  VendorBill: { table: "vendor_bill", permission: "record:delete", label: "Supplier bill", path: "/vendor-bills/", select: "billNumber", opensWhenDeleted: false },
  Payment: { table: "payment", permission: "record:delete", label: "Payment", path: "/payments/", select: "paymentNumber", opensWhenDeleted: false },
  Expense: { table: "expense", permission: "record:delete", label: "Expense claim", path: "/expenses/", select: "expenseNumber, description", opensWhenDeleted: false },
  StaffProfile: { table: "staff_profile", permission: "record:delete", label: "Person (HR)", path: "/people/", select: "profileNumber, fullName", opensWhenDeleted: false, serviceOnly: true },
  EmploymentContract: { table: "employment_contract", permission: "record:delete", label: "Contract (HR)", path: "/people/contracts/", select: "contractNumber, jobTitle", opensWhenDeleted: false, serviceOnly: true },
} as const;

/** Whether this kind is read with the service role (see above). */
export function isServiceOnly(type: RecycleType): boolean {
  return "serviceOnly" in RECYCLE_TYPES[type];
}

export type RecycleType = keyof typeof RECYCLE_TYPES;

export function recycleLabel(type: RecycleType, row: Record<string, unknown>): string {
  const s = (k: string) => (row[k] as string | null | undefined) ?? "";
  const pair = (a: string, b: string) => [s(a), s(b)].filter(Boolean).join(" · ");
  switch (type) {
    case "Lead":
      return [`${s("firstName")} ${s("lastName")}`.trim(), s("companyName")].filter(Boolean).join(" · ");
    case "Contact":
    case "CampaignMember":
      return `${s("firstName")} ${s("lastName")}`.trim();
    case "SupportCase":
      return `${s("caseNumber")} ${s("subject")}`.trim();
    case "Quotation":
      return s("quoteNumber");
    case "Contract":
      return pair("contractNumber", "name");
    case "Project":
      return pair("projectNumber", "name");
    case "Partner":
      return pair("partnerNumber", "displayName");
    case "KnowledgeArticle":
      return pair("articleNumber", "title");
    case "Activity":
      return s("subject");
    case "Invoice":
      return s("invoiceNumber");
    case "VendorBill":
      return s("billNumber");
    case "Payment":
      return s("paymentNumber");
    case "Expense":
      return pair("expenseNumber", "description");
    case "StaffProfile":
      return pair("profileNumber", "fullName");
    case "EmploymentContract":
      return pair("contractNumber", "jobTitle");
    default:
      return s("name");
  }
}
