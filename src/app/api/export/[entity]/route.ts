import { NextRequest } from "next/server";
import { toCsv, csvFilename, csvResponse, type CsvColumn } from "@/lib/csv";
import { requireUser, can, PERMISSIONS, AuthorizationError } from "@/lib/authz";
import { listAccounts, listContacts, listLeads, listProducts, listCampaigns } from "@/server/crm";
import { listOpportunities } from "@/server/opportunities";
import { listProjects } from "@/server/projects";
import { listPartners } from "@/server/partners";
import { listCommissions } from "@/server/commissions";
import { listPayments } from "@/server/billing";
import { listExpenses, listVendorBills } from "@/server/payables";
import { LIST_LIMIT } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase";
import { one } from "@/lib/decimal";

/**
 * CSV export for the list screens.
 *
 * Every export goes through the same list function the screen uses, so the
 * file contains exactly the rows that user can see — RLS and data scope apply
 * unchanged. An export that bypassed them would be the easiest way to read
 * someone else's pipeline.
 *
 * The filters come from the same query string, so "export" means "export what
 * I am looking at" rather than "export everything".
 */

type Row = Record<string, any>;

interface ExportDefinition {
  /** Permission the caller needs. Checked before any data is read. */
  needs: string;
  filename: string;
  load: (params: URLSearchParams) => Promise<Row[]>;
  columns: CsvColumn<Row>[];
}

const EXPORTS: Record<string, ExportDefinition> = {
  accounts: {
    needs: PERMISSIONS.ACCOUNT_READ,
    filename: "accounts",
    load: (p) =>
      listAccounts({
        search: p.get("search") ?? undefined,
        accountType: p.get("accountType") ?? undefined,
      }),
    columns: [
      { header: "Account number", value: (r) => r.accountNumber },
      { header: "Name", value: (r) => r.name },
      { header: "Type", value: (r) => r.accountType },
      { header: "Status", value: (r) => r.customerStatus },
      { header: "Owner", value: (r) => r.owner?.fullName },
      { header: "Industry", value: (r) => r.industry },
      { header: "Website", value: (r) => r.website },
      { header: "Phone", value: (r) => r.mainPhone },
      { header: "Health", value: (r) => r.customerHealth },
      { header: "Credit limit", value: (r) => Number(r.creditLimit ?? 0) },
      { header: "Payment terms (days)", value: (r) => r.paymentTermsDays },
      { header: "Contacts", value: (r) => r._count?.contacts ?? 0 },
      { header: "Open deals", value: (r) => r._count?.opportunities ?? 0 },
      { header: "Created", value: (r) => r.createdAt },
    ],
  },

  contacts: {
    needs: PERMISSIONS.ACCOUNT_READ,
    filename: "contacts",
    load: (p) => listContacts({ search: p.get("search") ?? undefined }),
    columns: [
      { header: "First name", value: (r) => r.firstName },
      { header: "Last name", value: (r) => r.lastName },
      { header: "Account", value: (r) => r.account?.name },
      { header: "Job title", value: (r) => r.jobTitle },
      { header: "Email", value: (r) => r.email },
      { header: "Phone", value: (r) => r.phone },
      { header: "Mobile", value: (r) => r.mobile },
      { header: "Primary", value: (r) => Boolean(r.isPrimary) },
      { header: "Consent given", value: (r) => Boolean(r.communicationConsent) },
      { header: "Active", value: (r) => Boolean(r.active) },
    ],
  },

  leads: {
    needs: PERMISSIONS.LEAD_READ,
    filename: "leads",
    load: (p) =>
      listLeads({
        search: p.get("search") ?? undefined,
        status: p.get("status") ?? undefined,
        source: p.get("source") ?? undefined,
      }),
    columns: [
      { header: "Lead number", value: (r) => r.leadNumber },
      { header: "First name", value: (r) => r.firstName },
      { header: "Last name", value: (r) => r.lastName },
      { header: "Company", value: (r) => r.companyName },
      { header: "Email", value: (r) => r.email },
      { header: "Phone", value: (r) => r.phone },
      { header: "Status", value: (r) => r.status },
      { header: "Rating", value: (r) => r.rating },
      { header: "Source", value: (r) => r.leadSource },
      { header: "Estimated value", value: (r) => Number(r.estimatedValue ?? 0) },
      { header: "Owner", value: (r) => r.owner?.fullName },
      { header: "Next follow-up", value: (r) => r.nextFollowUpAt },
      { header: "Created", value: (r) => r.createdAt },
    ],
  },

  opportunities: {
    needs: PERMISSIONS.OPPORTUNITY_READ,
    filename: "opportunities",
    load: (p) =>
      listOpportunities({
        search: p.get("search") ?? undefined,
        stage: p.get("stage") ?? undefined,
      }),
    columns: [
      { header: "Number", value: (r) => r.opportunityNumber },
      { header: "Name", value: (r) => r.name },
      { header: "Account", value: (r) => r.account?.name },
      { header: "Stage", value: (r) => r.stage },
      { header: "Amount", value: (r) => Number(r.amount ?? 0) },
      { header: "Currency", value: (r) => r.currencyCode },
      { header: "Probability %", value: (r) => Number(r.probabilityPercent ?? 0) },
      { header: "Expected close", value: (r) => r.expectedCloseDate },
      { header: "Actual close", value: (r) => r.actualCloseDate },
      { header: "Type", value: (r) => r.opportunityType },
      { header: "Source", value: (r) => r.leadSource },
      { header: "Owner", value: (r) => r.owner?.fullName },
      { header: "Loss reason", value: (r) => r.lossReason },
    ],
  },

  products: {
    needs: PERMISSIONS.OPPORTUNITY_READ,
    filename: "products",
    load: (p) =>
      listProducts(false, {
        search: p.get("search") ?? undefined,
        productType: p.get("productType") ?? undefined,
      }),
    columns: [
      { header: "Code", value: (r) => r.productCode },
      { header: "Name", value: (r) => r.name },
      { header: "Category", value: (r) => r.category },
      { header: "Type", value: (r) => r.productType },
      { header: "Billing", value: (r) => r.billingType },
      { header: "Unit", value: (r) => r.unitOfMeasure },
      { header: "Price", value: (r) => Number(r.standardPrice ?? 0) },
      { header: "Cost", value: (r) => Number(r.standardCost ?? 0) },
      { header: "Commission %", value: (r) => Number(r.commissionPercent ?? 0) },
      { header: "Commissionable", value: (r) => Boolean(r.commissionable) },
      { header: "Active", value: (r) => Boolean(r.active) },
    ],
  },

  campaigns: {
    needs: PERMISSIONS.LEAD_READ,
    filename: "campaigns",
    load: (p) =>
      listCampaigns({
        search: p.get("search") ?? undefined,
        status: p.get("status") ?? undefined,
      }),
    columns: [
      { header: "Number", value: (r) => r.campaignNumber },
      { header: "Name", value: (r) => r.name },
      { header: "Type", value: (r) => r.campaignType?.name },
      { header: "Status", value: (r) => r.status },
      { header: "Owner", value: (r) => r.owner?.fullName },
      { header: "Start", value: (r) => r.startDate },
      { header: "End", value: (r) => r.endDate },
      { header: "Budget", value: (r) => Number(r.budgetAmount ?? 0) },
      { header: "Actual cost", value: (r) => Number(r.actualCost ?? 0) },
      { header: "Leads", value: (r) => r._count?.leads ?? 0 },
      { header: "Deals", value: (r) => r._count?.opportunities ?? 0 },
    ],
  },

  projects: {
    needs: PERMISSIONS.PROJECT_READ,
    filename: "projects",
    load: (p) =>
      listProjects({
        search: p.get("search") ?? undefined,
        status: p.get("status") ?? undefined,
      }),
    columns: [
      { header: "Number", value: (r) => r.projectNumber },
      { header: "Name", value: (r) => r.name },
      { header: "Account", value: (r) => r.account?.name },
      { header: "Status", value: (r) => r.status },
      { header: "Health", value: (r) => r.health },
      { header: "Manager", value: (r) => r.projectManager?.fullName },
      { header: "Billing", value: (r) => r.billingType },
      { header: "Start", value: (r) => r.startDate },
      { header: "Planned end", value: (r) => r.plannedEndDate },
      { header: "Contract value", value: (r) => Number(r.contractValue ?? 0) },
      { header: "Complete %", value: (r) => Number(r.completionPercent ?? 0) },
    ],
  },

  partners: {
    needs: PERMISSIONS.PARTNER_READ,
    filename: "partners",
    load: (p) =>
      listPartners({
        search: p.get("search") ?? undefined,
        status: p.get("status") ?? undefined,
      }),
    columns: [
      { header: "Number", value: (r) => r.partnerNumber },
      { header: "Name", value: (r) => r.displayName },
      { header: "Kind", value: (r) => r.kind },
      { header: "Type", value: (r) => r.partnerType },
      { header: "Tier", value: (r) => r.tier },
      { header: "Status", value: (r) => r.status },
      { header: "Territory", value: (r) => r.territory },
      { header: "Email", value: (r) => r.email },
      { header: "Phone", value: (r) => r.phone },
      { header: "Commission %", value: (r) => Number(r.defaultCommissionPercent ?? 0) },
      { header: "Agreement expires", value: (r) => r.agreementExpiryDate },
    ],
  },

  commissions: {
    needs: PERMISSIONS.COMMISSION_READ,
    filename: "commissions",
    load: (p) =>
      listCommissions({
        status: p.get("status") ?? undefined,
        partnerId: p.get("partnerId") ?? undefined,
      }),
    columns: [
      { header: "Number", value: (r) => r.commissionNumber },
      { header: "Partner", value: (r) => r.partner?.displayName },
      { header: "Deal", value: (r) => r.opportunity?.name },
      { header: "Status", value: (r) => r.status },
      { header: "Basis", value: (r) => r.basis },
      { header: "Basis amount", value: (r) => Number(r.basisAmount ?? 0) },
      { header: "Rate %", value: (r) => Number(r.ratePercent ?? 0) },
      { header: "Commission", value: (r) => Number(r.commissionAmount ?? 0) },
      { header: "Withheld", value: (r) => Number(r.withholdingTaxAmount ?? 0) },
      { header: "Net payable", value: (r) => Number(r.netPayableAmount ?? 0) },
      { header: "Currency", value: (r) => r.currencyCode },
      { header: "Earned", value: (r) => r.earnedDate },
    ],
  },

  payments: {
    needs: PERMISSIONS.INVOICE_READ,
    filename: "payments",
    load: (p) =>
      listPayments({
        search: p.get("search") ?? undefined,
        status: p.get("status") ?? undefined,
        unappliedOnly: p.get("filter") === "unapplied",
      }),
    columns: [
      { header: "Number", value: (r) => r.paymentNumber },
      { header: "Account", value: (r) => r.account?.name },
      { header: "Date", value: (r) => r.paymentDate },
      { header: "Method", value: (r) => r.paymentMethod },
      { header: "Reference", value: (r) => r.referenceNumber },
      { header: "Amount", value: (r) => Number(r.amount ?? 0) },
      { header: "Unallocated", value: (r) => Number(r.unallocatedAmount ?? 0) },
      { header: "Currency", value: (r) => r.currencyCode },
      { header: "Status", value: (r) => r.status },
      {
        header: "Applied to",
        value: (r) =>
          (r.allocations ?? [])
            .map((a: Row) => a.invoice?.invoiceNumber)
            .filter(Boolean)
            .join(" "),
      },
    ],
  },

  expenses: {
    needs: PERMISSIONS.EXPENSE_READ,
    filename: "expenses",
    // An export is the whole filtered set, not the page being looked at, so it
    // asks for one page big enough to hold everything.
    load: async (p) =>
      (
        await listExpenses({
          search: p.get("search") ?? undefined,
          approvalStatus: p.get("approvalStatus") ?? undefined,
          paymentStatus: p.get("paymentStatus") ?? undefined,
          page: 1,
          pageSize: LIST_LIMIT,
        })
      ).rows,
    columns: [
      { header: "Number", value: (r) => r.expenseNumber },
      { header: "Date", value: (r) => r.expenseDate },
      { header: "Category", value: (r) => r.category?.name },
      { header: "GL code", value: (r) => r.category?.glCode },
      { header: "Employee", value: (r) => r.employee?.fullName },
      { header: "Supplier", value: (r) => r.vendor?.name },
      { header: "Project", value: (r) => r.project?.name },
      { header: "Amount", value: (r) => Number(r.amount ?? 0) },
      { header: "Tax", value: (r) => Number(r.taxAmount ?? 0) },
      { header: "Currency", value: (r) => r.currencyCode },
      { header: "Billable", value: (r) => Boolean(r.billableToCustomer) },
      { header: "Reimbursable", value: (r) => Boolean(r.reimbursable) },
      { header: "Approval", value: (r) => r.approvalStatus },
      { header: "Payment", value: (r) => r.paymentStatus },
      { header: "Description", value: (r) => r.description },
    ],
  },

  "vendor-bills": {
    needs: PERMISSIONS.INVOICE_READ,
    filename: "vendor-bills",
    load: (p) =>
      listVendorBills({
        search: p.get("search") ?? undefined,
        status: p.get("status") ?? undefined,
      }),
    columns: [
      { header: "Bill number", value: (r) => r.billNumber },
      { header: "Supplier", value: (r) => r.vendor?.name },
      { header: "Their reference", value: (r) => r.vendorInvoiceNumber },
      { header: "Project", value: (r) => r.project?.name },
      { header: "Bill date", value: (r) => r.billDate },
      { header: "Due date", value: (r) => r.dueDate },
      { header: "Status", value: (r) => r.status },
      { header: "Subtotal", value: (r) => Number(r.subtotal ?? 0) },
      { header: "Tax", value: (r) => Number(r.taxAmount ?? 0) },
      { header: "Total", value: (r) => Number(r.totalAmount ?? 0) },
      { header: "Paid", value: (r) => Number(r.paidAmount ?? 0) },
      { header: "Outstanding", value: (r) => Number(r.outstandingAmount ?? 0) },
      { header: "Currency", value: (r) => r.currencyCode },
    ],
  },

  // Invoices and quotations are read inline on their pages rather than through
  // a list function, so they are queried here the same way those pages do.
  invoices: {
    needs: PERMISSIONS.INVOICE_READ,
    filename: "invoices",
    load: async (p) => {
      const db = await supabaseServer();
      let query = db
        .from("invoice")
        .select("*, account ( id, name ), project ( id, name )")
        .is("deletedAt", null)
        .order("dueDate");

      const status = p.get("status");
      if (status) query = query.eq("status", status);

      const search = p.get("search")?.replace(/[,()]/g, "").trim();
      if (search) query = query.ilike("invoiceNumber", `%${search}%`);

      const { data } = await query.limit(1000);
      return (data ?? []).map((i) => ({
        ...i,
        account: one(i.account as never),
        project: one(i.project as never),
      })) as Row[];
    },
    columns: [
      { header: "Invoice number", value: (r) => r.invoiceNumber },
      { header: "Account", value: (r) => r.account?.name },
      { header: "Project", value: (r) => r.project?.name },
      { header: "Invoice date", value: (r) => r.invoiceDate },
      { header: "Due date", value: (r) => r.dueDate },
      { header: "Status", value: (r) => r.status },
      { header: "Subtotal", value: (r) => Number(r.subtotal ?? 0) },
      { header: "Tax", value: (r) => Number(r.taxAmount ?? 0) },
      { header: "Total", value: (r) => Number(r.totalAmount ?? 0) },
      { header: "Paid", value: (r) => Number(r.paidAmount ?? 0) },
      { header: "Outstanding", value: (r) => Number(r.outstandingAmount ?? 0) },
      { header: "Currency", value: (r) => r.currencyCode },
    ],
  },

  quotations: {
    needs: PERMISSIONS.OPPORTUNITY_READ,
    filename: "quotations",
    load: async (p) => {
      const db = await supabaseServer();
      let query = db
        .from("quotation")
        .select(
          "*, account ( id, name ), opportunity ( id, name, opportunityNumber )",
        )
        .is("deletedAt", null)
        .order("quoteDate", { ascending: false });

      const status = p.get("status");
      if (status) query = query.eq("status", status);

      const search = p.get("search")?.replace(/[,()]/g, "").trim();
      if (search) query = query.ilike("quoteNumber", `%${search}%`);

      const { data } = await query.limit(1000);
      return (data ?? []).map((q) => ({
        ...q,
        account: one(q.account as never),
        opportunity: one(q.opportunity as never),
      })) as Row[];
    },
    columns: [
      { header: "Quote number", value: (r) => r.quoteNumber },
      { header: "Version", value: (r) => r.versionNumber },
      { header: "Account", value: (r) => r.account?.name },
      { header: "Deal", value: (r) => r.opportunity?.name },
      { header: "Quote date", value: (r) => r.quoteDate },
      { header: "Expires", value: (r) => r.expiryDate },
      { header: "Status", value: (r) => r.status },
      { header: "Approval", value: (r) => r.approvalStatus },
      { header: "Subtotal", value: (r) => Number(r.subtotal ?? 0) },
      { header: "Discount", value: (r) => Number(r.discountAmount ?? 0) },
      { header: "Tax", value: (r) => Number(r.taxAmount ?? 0) },
      { header: "Total", value: (r) => Number(r.totalAmount ?? 0) },
      { header: "Currency", value: (r) => r.currencyCode },
    ],
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string }> },
) {
  const { entity } = await params;
  const definition = EXPORTS[entity];

  if (!definition) {
    return new Response("Unknown export", { status: 404 });
  }

  try {
    const me = await requireUser();

    if (!can(me, definition.needs)) {
      return new Response("You do not have access to that data.", { status: 403 });
    }

    const rows = await definition.load(request.nextUrl.searchParams);
    const csv = toCsv(rows, definition.columns);

    return csvResponse(csv, csvFilename(definition.filename));
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("Not signed in.", { status: 401 });
    }
    return new Response(
      error instanceof Error ? error.message : "Export failed.",
      { status: 500 },
    );
  }
}
