import Link from "next/link";
import { Plus } from "lucide-react";
import { listPayments } from "@/server/billing";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Button, Forbidden
} from "@/components/ui";
import { formatMoney, formatDate, humanize } from "@/lib/utils";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.INVOICE_READ)) return <Forbidden what="payments" />;

  const { filter } = await searchParams;
  const payments = await listPayments({ unappliedOnly: filter === "unapplied" });

  const cleared = payments.filter((p: Record<string, any>) => p.status === "CLEARED");
  const received = cleared.reduce((s, p) => s + Number(p.amount), 0);
  const unapplied = payments.reduce((s, p) => s + Number(p.unallocatedAmount), 0);
  const pending = payments.filter((p: Record<string, any>) => p.status === "PENDING");

  return (
    <>
      <PageHeader
        title="Payments"
        description="Cash received and how it has been applied. Unapplied cash is money you hold that no invoice has claimed."
      >
        <Button asChild>
          <Link href="/payments/new">
            <Plus className="h-4 w-4" /> Record payment
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Cleared receipts" value={formatMoney(received)} sublabel={`${cleared.length} payment(s)`} />
        <StatTile
          label="Unapplied cash"
          value={formatMoney(unapplied)}
          tone={unapplied > 0 ? "warning" : "success"}
          href="/payments?filter=unapplied"
        />
        <StatTile
          label="Awaiting clearance"
          value={String(pending.length)}
          sublabel={formatMoney(pending.reduce((s, p) => s + Number(p.amount), 0))}
          tone={pending.length ? "info" : "neutral"}
        />
        <StatTile label="Total payments" value={String(payments.length)} />
      </div>

      <Card className="mt-6">
        {payments.length === 0 ? (
          <EmptyState
            title={filter === "unapplied" ? "No unapplied cash" : "No payments recorded"}
            description="Record a receipt and apply it against the customer's open invoices."
            action={
              <Button asChild>
                <Link href="/payments/new">Record a payment</Link>
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Payment</TH>
                <TH>Customer</TH>
                <TH>Received</TH>
                <TH>Method</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Unapplied</TH>
                <TH>Applied to</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {payments.map((p: Record<string, any>) => (
                <TR key={p.id}>
                  <TD className="font-mono text-xs">
                    {p.paymentNumber}
                    {p.referenceNumber && (
                      <p className="text-xs text-muted-foreground">{p.referenceNumber}</p>
                    )}
                  </TD>
                  <TD className="text-sm">
                    <Link href={`/accounts/${p.account?.id}`} className="hover:underline">
                      {p.account?.name}
                    </Link>
                  </TD>
                  <TD className="whitespace-nowrap text-sm">{formatDate(p.paymentDate)}</TD>
                  <TD className="text-sm text-muted-foreground">{humanize(p.paymentMethod)}</TD>
                  <TD className="text-right font-medium tabular">{formatMoney(p.amount, p.currencyCode)}</TD>
                  <TD className="text-right tabular">
                    {Number(p.unallocatedAmount) > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {formatMoney(p.unallocatedAmount, p.currencyCode)}
                      </span>
                    ) : "—"}
                  </TD>
                  <TD className="text-sm">
                    {p.allocations.length === 0 ? (
                      <span className="text-muted-foreground">Nothing</span>
                    ) : (
                      <div className="space-y-0.5">
                        {p.allocations.map((a: Record<string, any>) => (
                          <Link
                            key={a.id}
                            href={`/invoices/${a.invoice?.id}`}
                            className="block font-mono text-xs hover:underline"
                          >
                            {a.invoice?.invoiceNumber}
                          </Link>
                        ))}
                      </div>
                    )}
                  </TD>
                  <TD><Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
