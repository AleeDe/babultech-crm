import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, StatTile, DetailRow, Alert, Button,
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, formatNumber, humanize, daysBetween } from "@/lib/utils";
import { InvoiceActions } from "./invoice-actions";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePermission(PERMISSIONS.INVOICE_READ);

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true, accountNumber: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
      contract: { select: { id: true, contractNumber: true, name: true } },
      milestone: { select: { id: true, name: true, projectId: true } },
      lines: {
        include: {
          product: { select: { id: true, name: true, productCode: true } },
          taxRate: { select: { id: true, name: true, ratePercent: true } },
          project: { select: { id: true, name: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
      allocations: {
        include: {
          payment: {
            select: {
              id: true, paymentNumber: true, paymentDate: true, paymentMethod: true,
              currencyCode: true,
            },
          },
          allocatedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { allocatedAt: "desc" },
      },
      commissionRecords: {
        select: {
          id: true, commissionNumber: true, commissionAmount: true, status: true,
          currencyCode: true, partner: { select: { id: true, displayName: true } },
        },
      },
    },
  });

  if (!invoice) notFound();

  const outstanding = Number(invoice.outstandingAmount);
  const total = Number(invoice.totalAmount);
  const paidPercent = total > 0 ? (Number(invoice.paidAmount) / total) * 100 : 0;
  const daysOverdue = daysBetween(invoice.dueDate, new Date());
  const overdue = outstanding > 0 && daysOverdue > 0 && !["DRAFT", "CANCELLED", "PAID"].includes(invoice.status);

  return (
    <>
      <PageHeader
        title={invoice.invoiceNumber}
        description={`${invoice.account.name} · issued ${formatDate(invoice.invoiceDate)}`}
      >
        <Badge tone={statusTone(invoice.status)}>{humanize(invoice.status)}</Badge>
        {["DRAFT", "APPROVED"].includes(invoice.status) && (
          <Button asChild variant="outline">
            <Link href={`/invoices/${invoice.id}/edit`}>Edit</Link>
          </Button>
        )}
      </PageHeader>

      {overdue && (
        <div className="mb-5">
          <Alert tone="danger">
            {formatMoney(outstanding, invoice.currencyCode)} is {daysOverdue} day(s) overdue.
          </Alert>
        </div>
      )}
      {Number(invoice.writeOffAmount) > 0 && (
        <div className="mb-5">
          <Alert tone="warning">
            {formatMoney(invoice.writeOffAmount, invoice.currencyCode)} has been written off against
            this invoice.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total" value={formatMoney(invoice.totalAmount, invoice.currencyCode)} />
        <StatTile
          label="Paid"
          value={formatMoney(invoice.paidAmount, invoice.currencyCode)}
          sublabel={`${formatPercent(paidPercent, 0)} settled`}
          tone={paidPercent >= 100 ? "success" : paidPercent > 0 ? "info" : "neutral"}
        />
        <StatTile
          label="Outstanding"
          value={formatMoney(invoice.outstandingAmount, invoice.currencyCode)}
          tone={outstanding > 0 ? (overdue ? "danger" : "warning") : "success"}
        />
        <StatTile
          label="Due"
          value={formatDate(invoice.dueDate)}
          sublabel={invoice.paymentTermsDays ? `${invoice.paymentTermsDays} day terms` : undefined}
          tone={overdue ? "danger" : "neutral"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Lines</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {invoice.lines.length === 0 ? (
                <p className="px-5 pb-2 text-sm text-muted-foreground">This invoice has no lines.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Description</TH>
                      <TH className="text-right">Qty</TH>
                      <TH className="text-right">Unit price</TH>
                      <TH className="text-right">Discount</TH>
                      <TH>Tax</TH>
                      <TH className="text-right">Total</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {invoice.lines.map((l) => (
                      <TR key={l.id}>
                        <TD className="text-sm">
                          {l.product ? (
                            <Link href={`/products/${l.product.id}`} className="font-medium hover:underline">
                              {l.product.name}
                            </Link>
                          ) : (
                            <span className="font-medium">{l.description}</span>
                          )}
                          {l.product && <p className="text-xs text-muted-foreground">{l.description}</p>}
                          {l.project && (
                            <Link href={`/projects/${l.project.id}`} className="text-xs text-primary hover:underline">
                              {l.project.name}
                            </Link>
                          )}
                        </TD>
                        <TD className="text-right tabular">{formatNumber(l.quantity, 2)}</TD>
                        <TD className="text-right tabular">{formatMoney(l.unitPrice, invoice.currencyCode)}</TD>
                        <TD className="text-right tabular">{formatPercent(l.discountPercent)}</TD>
                        <TD className="text-sm text-muted-foreground">{l.taxRate?.name ?? "—"}</TD>
                        <TD className="text-right font-medium tabular">{formatMoney(l.lineTotal, invoice.currencyCode)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}

              <div className="mt-3 space-y-1 border-t px-5 pt-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular">{formatMoney(invoice.subtotal, invoice.currencyCode)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular">−{formatMoney(invoice.discountAmount, invoice.currencyCode)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular">{formatMoney(invoice.taxAmount, invoice.currencyCode)}</span></div>
                <div className="flex justify-between border-t pt-1 font-semibold"><span>Total</span><span className="tabular">{formatMoney(invoice.totalAmount, invoice.currencyCode)}</span></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments applied</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {invoice.allocations.length === 0 ? (
                <p className="px-5 pb-2 text-sm text-muted-foreground">Nothing received against this invoice.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Payment</TH>
                      <TH>Received</TH>
                      <TH>Method</TH>
                      <TH>Applied by</TH>
                      <TH className="text-right">Amount</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {invoice.allocations.map((a) => (
                      <TR key={a.id}>
                        <TD className="font-mono text-xs">{a.payment.paymentNumber}</TD>
                        <TD className="text-sm">{formatDate(a.payment.paymentDate)}</TD>
                        <TD className="text-sm text-muted-foreground">{humanize(a.payment.paymentMethod)}</TD>
                        <TD className="text-sm text-muted-foreground">{a.allocatedBy?.fullName ?? "System"}</TD>
                        <TD className="text-right font-medium tabular">
                          {formatMoney(a.allocatedAmount, invoice.currencyCode)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <InvoiceActions
            invoiceId={invoice.id}
            status={invoice.status}
            outstanding={String(invoice.outstandingAmount)}
            currency={invoice.currencyCode}
          />

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Customer">
                <Link href={`/accounts/${invoice.account.id}`} className="text-primary hover:underline">
                  {invoice.account.name}
                </Link>
                <p className="text-xs text-muted-foreground">{invoice.account.accountNumber}</p>
              </DetailRow>
              <DetailRow label="Bill to">
                {invoice.contact ? (
                  <Link href={`/contacts/${invoice.contact.id}/edit`} className="text-primary hover:underline">
                    {invoice.contact.firstName} {invoice.contact.lastName}
                  </Link>
                ) : "—"}
              </DetailRow>
              <DetailRow label="Project">
                {invoice.project ? (
                  <Link href={`/projects/${invoice.project.id}`} className="text-primary hover:underline">
                    {invoice.project.projectNumber} — {invoice.project.name}
                  </Link>
                ) : "—"}
              </DetailRow>
              <DetailRow label="Contract">
                {invoice.contract ? (
                  <Link href={`/contracts/${invoice.contract.id}`} className="text-primary hover:underline">
                    {invoice.contract.contractNumber}
                  </Link>
                ) : "—"}
              </DetailRow>
              <DetailRow label="Milestone">
                {invoice.milestone ? (
                  <Link href={`/projects/${invoice.milestone.projectId}`} className="text-primary hover:underline">
                    {invoice.milestone.name}
                  </Link>
                ) : "—"}
              </DetailRow>
              <DetailRow label="Currency">{invoice.currencyCode}</DetailRow>
              <DetailRow label="Sent">{formatDate(invoice.sentAt)}</DetailRow>
            </CardContent>
          </Card>

          {invoice.commissionRecords.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Partner commission</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {invoice.commissionRecords.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0">
                    <Link href={`/partners/${c.partner.id}`} className="text-primary hover:underline">
                      {c.partner.displayName}
                      <span className="block font-mono text-xs text-muted-foreground">{c.commissionNumber}</span>
                    </Link>
                    <div className="text-right">
                      <p className="tabular text-xs">{formatMoney(c.commissionAmount, c.currencyCode)}</p>
                      <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {invoice.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{invoice.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
