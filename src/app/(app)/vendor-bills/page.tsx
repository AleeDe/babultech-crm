import Link from "next/link";
import { Plus } from "lucide-react";
import { listVendorBills, getPayablesSummary } from "@/server/payables";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { ListFilters, optionsFrom } from "@/components/list-filters";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Button, Forbidden,
} from "@/components/ui";
import { formatMoney, formatDate, humanize, daysBetween } from "@/lib/utils";

/** Payables: what is owed to suppliers, and what is already late. */
export default async function VendorBillsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.INVOICE_READ)) return <Forbidden what="vendor bills" />;

  const params = await searchParams;
  const [bills, summary] = await Promise.all([listVendorBills(params), getPayablesSummary()]);

  const now = new Date();

  return (
    <>
      <PageHeader
        title="Vendor bills"
        description="What suppliers have invoiced you, and what is still owed to them."
      >
        <Button asChild variant="outline">
          <Link href="/expenses">Expenses</Link>
        </Button>
        {can(me, PERMISSIONS.INVOICE_WRITE) && (
          <Button asChild>
            <Link href="/vendor-bills/new">
              <Plus className="h-4 w-4" /> New bill
            </Link>
          </Button>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Owed to suppliers"
          value={formatMoney(summary.billsOutstanding)}
          sublabel={`${summary.billsOutstandingCount} open bill(s)`}
        />
        <StatTile
          label="Overdue"
          value={formatMoney(summary.billsOverdue)}
          sublabel={`${summary.billsOverdueCount} past due`}
          tone={summary.billsOverdueCount > 0 ? "danger" : "success"}
        />
        <StatTile
          label="Expenses to settle"
          value={formatMoney(summary.expensesToPay)}
          sublabel={`${summary.expensesToPayCount} approved`}
          href="/expenses?approvalStatus=APPROVED&paymentStatus=UNPAID"
          tone={summary.expensesToPayCount > 0 ? "info" : "neutral"}
        />
        <StatTile label="Total bills" value={String(bills.length)} />
      </div>

      <div className="mt-6">
        <ListFilters
          searchPlaceholder="Search bill or supplier invoice number…"
          searchValue={params.search}
          selects={[
            {
              name: "status",
              allLabel: "All statuses",
              value: params.status,
              options: optionsFrom([
                "DRAFT", "UNDER_REVIEW", "APPROVED",
                "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED",
              ]),
            },
          ]}
        />
      </div>

      <Card>
        {bills.length === 0 ? (
          <EmptyState
            title="No vendor bills match"
            description="A vendor bill is what a supplier invoices you for. Approving one makes it payable; recording a payment settles it."
            action={
              can(me, PERMISSIONS.INVOICE_WRITE) ? (
                <Button asChild>
                  <Link href="/vendor-bills/new">Enter a bill</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Bill</TH>
                <TH>Supplier</TH>
                <TH>Project</TH>
                <TH>Issued</TH>
                <TH>Due</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Outstanding</TH>
                <TH>Ageing</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {bills.map((b: Record<string, any>) => {
                const days = daysBetween(b.dueDate, now);
                const late = days > 0 && Number(b.outstandingAmount) > 0;
                const bucket = !late
                  ? "Current"
                  : days <= 30
                    ? "1-30"
                    : days <= 60
                      ? "31-60"
                      : days <= 90
                        ? "61-90"
                        : "90+";

                return (
                  <TR key={b.id}>
                    <TD>
                      <Link href={`/vendor-bills/${b.id}`} className="font-mono text-xs hover:underline">
                        {b.billNumber}
                      </Link>
                      {b.vendorInvoiceNumber && (
                        <p className="text-xs text-muted-foreground">
                          Their ref {b.vendorInvoiceNumber}
                        </p>
                      )}
                    </TD>
                    <TD className="text-sm">
                      <Link href={`/accounts/${b.vendor?.id}`} className="hover:underline">
                        {b.vendor?.name}
                      </Link>
                    </TD>
                    <TD className="text-sm">
                      {b.project ? (
                        <Link href={`/projects/${b.project.id}`} className="hover:underline">
                          {b.project.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-sm">{formatDate(b.billDate)}</TD>
                    <TD
                      className={`whitespace-nowrap text-sm ${late ? "text-red-600 dark:text-red-400" : ""}`}
                    >
                      {formatDate(b.dueDate)}
                    </TD>
                    <TD className="text-right tabular">{formatMoney(b.totalAmount, b.currencyCode)}</TD>
                    <TD className="text-right font-medium tabular">
                      {formatMoney(b.outstandingAmount, b.currencyCode)}
                    </TD>
                    <TD>
                      <Badge tone={late ? "danger" : "neutral"}>{bucket}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(b.status)}>{humanize(b.status)}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
