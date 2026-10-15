import { supabaseAdmin } from "./supabase";

/**
 * Names for the ids that change history stores.
 *
 * A history row keeps the raw value, so a new owner, manager or role is
 * written as an id and the record it belongs to only as its type. Both are
 * resolved here, when the history is read, so rows written before this
 * existed read as names too. A record removed since shows as "removed record".
 *
 * Read with the service role: the reader can already see the history row,
 * and the name of the person or record it points at is part of what changed.
 */

type Row = Record<string, unknown>;
interface Source { table: string; select: string; label: (r: Row) => string }

const text = (v: unknown) => (v == null ? "" : String(v).trim());
const joined = (...parts: unknown[]) => parts.map(text).filter(Boolean).join(" ");
const numbered = (number: unknown, name: unknown) => [text(number), text(name)].filter(Boolean).join(" · ");

const SOURCES: Record<string, Source> = {
  user: { table: "app_user", select: "id, fullName", label: (r) => text(r.fullName) },
  role: { table: "security_role", select: "id, name", label: (r) => text(r.name) },
  department: { table: "department", select: "id, name", label: (r) => text(r.name) },
  team: { table: "team", select: "id, name", label: (r) => text(r.name) },
  account: { table: "account", select: "id, name", label: (r) => text(r.name) },
  contact: { table: "contact", select: "id, firstName, lastName", label: (r) => joined(r.firstName, r.lastName) },
  lead: { table: "lead", select: "id, leadNumber, firstName, lastName, companyName", label: (r) => joined(r.firstName, r.lastName) || text(r.companyName) || text(r.leadNumber) },
  partner: { table: "partner", select: "id, displayName", label: (r) => text(r.displayName) },
  contract: { table: "contract", select: "id, contractNumber, name", label: (r) => numbered(r.contractNumber, r.name) },
  opportunity: { table: "opportunity", select: "id, name", label: (r) => text(r.name) },
  quotation: { table: "quotation", select: "id, quoteNumber", label: (r) => text(r.quoteNumber) },
  product: { table: "product", select: "id, name", label: (r) => text(r.name) },
  project: { table: "project", select: "id, name", label: (r) => text(r.name) },
  task: { table: "project_task", select: "id, name", label: (r) => text(r.name) },
  phase: { table: "project_phase", select: "id, name", label: (r) => text(r.name) },
  case: { table: "support_case", select: "id, caseNumber, subject", label: (r) => numbered(r.caseNumber, r.subject) },
  invoice: { table: "invoice", select: "id, invoiceNumber", label: (r) => text(r.invoiceNumber) },
  vendorBill: { table: "vendor_bill", select: "id, billNumber", label: (r) => text(r.billNumber) },
  payment: { table: "payment", select: "id, paymentNumber", label: (r) => text(r.paymentNumber) },
  expense: { table: "expense", select: "id, expenseNumber", label: (r) => text(r.expenseNumber) },
  category: { table: "expense_category", select: "id, name", label: (r) => text(r.name) },
  document: { table: "document", select: "id, fileName", label: (r) => text(r.fileName) },
  campaign: { table: "campaign", select: "id, name", label: (r) => text(r.name) },
  commission: { table: "partner_commission", select: "id, commissionNumber", label: (r) => text(r.commissionNumber) },
  staff: { table: "staff_profile", select: "id, fullName", label: (r) => text(r.fullName) },
  employmentContract: { table: "employment_contract", select: "id, contractNumber", label: (r) => text(r.contractNumber) },
};

/** Which kind of record an id-holding field points at. */
const FIELD_SOURCE: Record<string, string> = {
  roleId: "role", departmentId: "department", teamId: "team",
  accountId: "account", vendorAccountId: "account", contactId: "contact", leadId: "lead",
  partnerId: "partner", sourcePartnerId: "partner", contractId: "contract", opportunityId: "opportunity",
  quotationId: "quotation", productId: "product", projectId: "project", projectTaskId: "task", taskId: "task",
  phaseId: "phase", caseId: "case", invoiceId: "invoice", vendorBillId: "vendorBill", paymentId: "payment",
  expenseId: "expense", categoryId: "category", receiptDocumentId: "document", documentId: "document",
  campaignId: "campaign", staffId: "staff", projectManagerId: "user", reportsTo: "user", reportsToUserId: "user",
};

/** Which kind of record a history row is about. */
const ENTITY_SOURCE: Record<string, string> = {
  User: "user", Account: "account", Contact: "contact", Lead: "lead", Partner: "partner", Contract: "contract",
  Opportunity: "opportunity", Quotation: "quotation", Product: "product", Project: "project",
  ProjectTask: "task", Task: "task", Case: "case", SupportCase: "case", Invoice: "invoice",
  VendorBill: "vendorBill", Payment: "payment", Expense: "expense", Campaign: "campaign",
  PartnerCommission: "commission", Commission: "commission", StaffProfile: "staff", EmploymentContract: "employmentContract",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sourceForField(fieldName: string): string | null {
  if (FIELD_SOURCE[fieldName]) return FIELD_SOURCE[fieldName];
  // ownerUserId, assignedUserId, approvedById, managerUserId, employeeUserId…
  if (/(UserId|ById)$/.test(fieldName)) return "user";
  return null;
}

export interface LabelledAuditFields {
  oldValue: string | null;
  newValue: string | null;
  /** The name of the record the row is about, when asked for and known. */
  recordName: string | null;
}

/**
 * Replaces ids in oldValue/newValue with names, and (with `recordNames`) adds
 * the name of each row's record. Everything is looked up in one query per table.
 */
export async function labelAuditRows<T extends { entityType?: unknown; entityId?: unknown; fieldName?: unknown; oldValue?: unknown; newValue?: unknown }>(
  rows: T[],
  options: { recordNames?: boolean } = {},
): Promise<(T & LabelledAuditFields)[]> {
  const wanted = new Map<string, Set<string>>();
  const want = (source: string | null | undefined, id: unknown) => {
    if (!source || typeof id !== "string" || !UUID.test(id)) return;
    if (!wanted.has(source)) wanted.set(source, new Set());
    wanted.get(source)!.add(id);
  };

  for (const row of rows) {
    const source = sourceForField(String(row.fieldName ?? ""));
    want(source, row.oldValue);
    want(source, row.newValue);
    if (options.recordNames) want(ENTITY_SOURCE[String(row.entityType ?? "")], row.entityId);
  }

  const names = new Map<string, string>();
  const db = supabaseAdmin();
  await Promise.all([...wanted].map(async ([key, ids]) => {
    const source = SOURCES[key];
    const { data } = await db.from(source.table).select(source.select).in("id", [...ids]);
    for (const r of (data ?? []) as unknown as Row[]) names.set(`${key}:${r.id}`, source.label(r) || "unnamed");
  }));

  const value = (source: string | null, v: unknown): string | null => {
    if (v == null) return null;
    const raw = String(v);
    if (!source || !UUID.test(raw)) return raw;
    return names.get(`${source}:${raw}`) ?? "removed record";
  };

  return rows.map((row) => {
    const source = sourceForField(String(row.fieldName ?? ""));
    const entity = ENTITY_SOURCE[String(row.entityType ?? "")];
    return {
      ...row,
      oldValue: value(source, row.oldValue),
      newValue: value(source, row.newValue),
      recordName: options.recordNames && entity ? names.get(`${entity}:${String(row.entityId)}`) ?? null : null,
    } as T & LabelledAuditFields;
  });
}
