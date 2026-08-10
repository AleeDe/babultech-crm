import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Alert,
} from "@/components/ui";
import { formatMoney, formatDate, humanize, daysBetween } from "@/lib/utils";

/**
 * Read-only receivables view. Billing runs, payment allocation and the AP side
 * are Phase 4; the schema and the v_accounts_receivable view already exist.
 */
export default async function InvoicesPage() {
  await requireUser();

  const invoices = await prisma.invoice.findMany({
    where: { deletedAt: null },
    include: {
      account: { select: { id: true, name: true } },
      project: { select: { name: true } },
      _count: { select: { allocations: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  const now = new Date();
  const live = invoices.filter((i) => !["DRAFT", "CANCELLED", "PAID", "WRITTEN_OFF"].includes(i.status));
  const overdue = live.filter((i) => i.dueDate < now);
  const outstanding = live.reduce((s, i) => s + Number(i.outstandingAmount), 0);
  const overdueTotal = overdue.reduce((s, i) => s + Number(i.outstandingAmount), 0);

  return (
    <>
      <PageHeader title="Invoices" description="Customer billing and what is still owed to you." />

      <div className="mb-6">
        <Alert tone="info">
          Phase 4 module. Invoicing, payment allocation, expenses and vendor bills are modelled and
          the AR/AP views are written — this page reads them; the billing workflow comes next.
        </Alert>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Outstanding" value={formatMoney(outstanding)} sublabel={`${live.length} open invoices`} />
        <StatTile label="Overdue" value={formatMoney(overdueTotal)} sublabel={`${overdue.length} invoices`} tone={overdue.length ? "danger" : "success"} />
        <StatTile
          label="Collected"
          value={formatMoney(invoices.reduce((s, i) => s + Number(i.paidAmount), 0))}
          tone="success"
        />
        <StatTile label="Total invoices" value={String(invoices.length)} />
      </div>

      <Card className="mt-6">
        {invoices.length === 0 ? (
          <EmptyState title="No invoices yet" description="Invoices are raised from a contract, a billing milestone, or approved time." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Invoice</TH>
                <TH>Customer</TH>
                <TH>Issued</TH>
                <TH>Due</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Paid</TH>
                <TH className="text-right">Outstanding</TH>
                <TH>Ageing</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {invoices.map((i) => {
                const days = daysBetween(i.dueDate, now);
                const late = days > 0 && Number(i.outstandingAmount) > 0;
                const bucket = !late ? "Current" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";

                return (
                  <TR key={i.id}>
                    <TD className="font-mono text-xs">{i.invoiceNumber}</TD>
                    <TD className="text-sm">
                      <Link href={`/accounts/${i.account.id}`} className="hover:underline">
                        {i.account.name}
                      </Link>
                      {i.project && <p className="text-xs text-muted-foreground">{i.project.name}</p>}
                    </TD>
                    <TD className="text-sm">{formatDate(i.invoiceDate)}</TD>
                    <TD className={`text-sm ${late ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatDate(i.dueDate)}
                    </TD>
                    <TD className="text-right tabular">{formatMoney(i.totalAmount, i.currencyCode)}</TD>
                    <TD className="text-right tabular text-muted-foreground">
                      {formatMoney(i.paidAmount, i.currencyCode)}
                    </TD>
                    <TD className="text-right font-medium tabular">
                      {formatMoney(i.outstandingAmount, i.currencyCode)}
                    </TD>
                    <TD>
                      <Badge tone={late ? "danger" : "neutral"}>{bucket}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(i.status)}>{humanize(i.status)}</Badge>
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
