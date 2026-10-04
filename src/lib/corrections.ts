/**
 * When a record counts as processed, so that only an administrator may change
 * or delete it - and only by pressing Correct and saying why
 * (server/corrections.ts, 20261004000002_record_corrections.sql).
 *
 * `wordingOnly` marks the documents a customer already holds: an issued
 * invoice and a sent quote keep their amounts and lines; a correction changes
 * their wording, dates and references.
 */

type Row = Record<string, unknown>;
const v = (row: Row, key: string) => String(row[key] ?? "");
const lower = (s: string) => s.toLowerCase().replace(/_/g, " ");

export interface CorrectableKind {
  table: string;
  columns: string;
  label: string;
  /** Who is told about a correction. */
  ownerColumn: string | null;
  editPath: (id: string) => string;
  /** Why it is processed, or null while anyone with permission may still change it. */
  processed: (row: Row) => string | null;
  wordingOnly?: boolean;
}

export const CORRECTABLE = {
  Lead: {
    table: "lead", columns: "status, leadNumber, ownerUserId", label: "lead", ownerColumn: "ownerUserId",
    editPath: (id: string) => `/leads/${id}/edit`,
    processed: (r: Row) => (v(r, "status") === "CONVERTED" ? "It has been converted." : null),
  },
  Opportunity: {
    table: "opportunity", columns: "stage, name, ownerUserId", label: "deal", ownerColumn: "ownerUserId",
    editPath: (id: string) => `/opportunities/${id}/edit`,
    processed: (r: Row) => (v(r, "stage") === "CLOSED_WON" ? "It is won." : v(r, "stage") === "CLOSED_LOST" ? "It is lost." : null),
  },
  Quotation: {
    table: "quotation", columns: "status, quoteNumber", label: "quote", ownerColumn: null,
    editPath: (id: string) => `/quotations/${id}/edit`,
    processed: (r: Row) => (["DRAFT", "UNDER_REVIEW", "APPROVED"].includes(v(r, "status")) ? null : `It is ${lower(v(r, "status"))} and the customer has it.`),
    wordingOnly: true,
  },
  Contract: {
    table: "contract", columns: "status, contractNumber, ownerUserId", label: "contract", ownerColumn: "ownerUserId",
    editPath: (id: string) => `/contracts/${id}/edit`,
    processed: (r: Row) => (["ACTIVE", "EXPIRED", "TERMINATED", "RENEWED"].includes(v(r, "status")) ? `It is ${lower(v(r, "status"))}.` : null),
  },
  SupportCase: {
    table: "support_case", columns: "status, caseNumber, ownerUserId", label: "case", ownerColumn: "ownerUserId",
    editPath: (id: string) => `/cases/${id}/edit`,
    processed: (r: Row) => (["CLOSED", "CANCELLED"].includes(v(r, "status")) ? `It is ${lower(v(r, "status"))}.` : null),
  },
  Project: {
    table: "project", columns: "status, projectNumber, projectManagerId", label: "project", ownerColumn: "projectManagerId",
    editPath: (id: string) => `/projects/${id}/edit`,
    processed: (r: Row) => (["COMPLETED", "CANCELLED"].includes(v(r, "status")) ? `It is ${lower(v(r, "status"))}.` : null),
  },
  Campaign: {
    table: "campaign", columns: "status, campaignNumber, ownerUserId", label: "campaign", ownerColumn: "ownerUserId",
    editPath: (id: string) => `/campaigns/${id}/edit`,
    processed: (r: Row) => (v(r, "status") === "COMPLETED" ? "It is completed." : null),
  },
  Invoice: {
    table: "invoice", columns: "status, invoiceNumber, preparedById", label: "invoice", ownerColumn: "preparedById",
    editPath: (id: string) => `/invoices/${id}/edit`,
    processed: (r: Row) => (["DRAFT", "APPROVED"].includes(v(r, "status")) ? null : "It has been issued to the customer."),
    wordingOnly: true,
  },
  Expense: {
    table: "expense", columns: "approvalStatus, paymentStatus, expenseNumber, employeeUserId", label: "expense claim", ownerColumn: "employeeUserId",
    editPath: (id: string) => `/expenses/${id}/edit`,
    processed: (r: Row) => (v(r, "paymentStatus") === "PAID" ? "It has been paid." : v(r, "approvalStatus") === "APPROVED" ? "It is approved." : null),
  },
  VendorBill: {
    table: "vendor_bill", columns: "status, billNumber", label: "supplier bill", ownerColumn: null,
    editPath: (id: string) => `/vendor-bills/${id}/edit`,
    processed: (r: Row) => (v(r, "status") === "DRAFT" ? null : `It is ${lower(v(r, "status"))}.`),
  },
  Payment: {
    table: "payment", columns: "status, paymentNumber", label: "payment", ownerColumn: null,
    editPath: (id: string) => `/payments/${id}/edit`,
    processed: (r: Row) => (v(r, "status") === "CLEARED" ? "It has cleared." : null),
  },
} satisfies Record<string, CorrectableKind>;

export type CorrectableType = keyof typeof CORRECTABLE;

export function isCorrectable(type: string): type is CorrectableType {
  return type in CORRECTABLE;
}

/** How long a correction stays open after Correct is pressed. */
export const CORRECTION_MINUTES = 30;
