import Link from "next/link";
import { notFound } from "next/navigation";
import { getPayment } from "@/server/billing";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, StatTile, DetailRow, Alert, Forbidden,
} from "@/components/ui";
import { formatMoney, formatDate, humanize } from "@/lib/utils";

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.INVOICE_READ)) return <Forbidden what="payments" />;

  const { id } = await params;
  const payment = await getPayment(id);
  if (!payment) notFound();

  const unallocated = Number(payment.unallocatedAmount ?? 0);
  const allocated = Number(payment.amount ?? 0) - unallocated;

  return (
    <>
      <PageHeader
        backTo="/payments"
        backLabel="Back to payments"
        title={payment.paymentNumber}
        description={`${humanize(payment.paymentMethod)} · received ${formatDate(payment.paymentDate)}`}
      >
        <Badge tone={statusTone(payment.status)}>{humanize(payment.status)}</Badge>
      </PageHeader>

      {unallocated > 0 && (
        <div className="mb-5">
          <Alert tone="warning">
            {formatMoney(unallocated, payment.currencyCode)} of this payment is not yet applied to
            an invoice. Until it is, the customer&apos;s outstanding balance still shows it as owed.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Amount" value={formatMoney(payment.amount, payment.currencyCode)} />
        <StatTile label="Allocated" value={formatMoney(allocated, payment.currencyCode)} tone="success" />
        <StatTile
          label="Unallocated"
          value={formatMoney(unallocated, payment.currencyCode)}
          tone={unallocated > 0 ? "warning" : "neutral"}
        />
        <StatTile
          label="Cleared"
          value={payment.clearedAt ? formatDate(payment.clearedAt) : "Not yet"}
          tone={payment.clearedAt ? "neutral" : "warning"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Applied to</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {payment.allocations.length === 0 ? (
              <p className="px-5 pb-2 text-sm text-muted-foreground">
                Not applied to any invoice yet.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Invoice</TH>
                    <TH>Due</TH>
                    <TH className="text-right">Invoice total</TH>
                    <TH className="text-right">Applied</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {payment.allocations.map((a: Record<string, any>) => (
                    <TR key={String(a.id)}>
                      <TD>
                        <Link href={`/invoices/${a.invoice?.id}`} className="font-medium hover:underline">
                          {a.invoice?.invoiceNumber}
                        </Link>
                      </TD>
                      <TD className="text-sm text-muted-foreground">{formatDate(a.invoice?.dueDate)}</TD>
                      <TD className="text-right tabular">
                        {formatMoney(a.invoice?.totalAmount, a.invoice?.currencyCode)}
                      </TD>
                      <TD className="text-right font-medium tabular">
                        {formatMoney(a.allocatedAmount, payment.currencyCode)}
                      </TD>
                      <TD>
                        <Badge tone={statusTone(a.invoice?.status)}>{humanize(a.invoice?.status)}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="From">
              {payment.account ? (
                <Link href={`/accounts/${payment.account?.id}`} className="text-primary hover:underline">
                  {payment.account?.name}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Method">{humanize(payment.paymentMethod)}</DetailRow>
            <DetailRow label="Reference">{payment.referenceNumber ?? "—"}</DetailRow>
            <DetailRow label="Into">{payment.bankAccount?.name ?? "—"}</DetailRow>
            <DetailRow label="Currency">{payment.currencyCode}</DetailRow>
            {payment.notes && (
              <DetailRow label="Notes">
                <span className="whitespace-pre-line">{payment.notes}</span>
              </DetailRow>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
