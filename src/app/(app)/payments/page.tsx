import Link from "next/link";
import { Plus } from "lucide-react";
import { listPayments } from "@/server/billing";
import { ListFilters, optionsFrom } from "@/components/list-filters";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Button, Forbidden
} from "@/components/ui";
import { formatMoney, formatDate, humanize } from "@/lib/utils";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { ExportButton } from "@/components/export-button";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; search?: string; status?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.INVOICE_READ)) return <Forbidden what="payments" />;

  const params = await searchParams;
  const { filter } = params;
  const payments = await listPayments({
    unappliedOnly: filter === "unapplied",
    search: params.search,
    status: params.status,
  });

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
        <ExportButton entity="payments" params={{ search: params.search, status: params.status, filter: params.filter }} />
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

      <div className="mt-6">
        <ListFilters
          searchPlaceholder="Search payment or reference number…"
          searchValue={params.search}
          selects={[
            {
              name: "status",
              allLabel: "All statuses",
              value: params.status,
              options: optionsFrom(["PENDING", "CLEARED", "FAILED", "REVERSED"]),
            },
          ]}
        >
          {/* The unapplied view is reached from a stat tile, so the flag has to
              survive a filter submit rather than being silently dropped. */}
          {filter && <input type="hidden" name="filter" value={filter} />}
        </ListFilters>
      </div>

      <Card>
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
                <TH priority="secondary">Customer</TH>
                <TH priority="secondary">Received</TH>
                <TH priority="tertiary">Method</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right" priority="tertiary">Unapplied</TH>
                <TH priority="tertiary">Applied to</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {payments.map((p: Record<string, any>) => (
                <TR key={p.id}>
                  <TD className="font-mono text-xs">
                    <Link href={`/payments/${p.id}`} className="font-medium hover:underline">
                      {p.paymentNumber}
                    </Link>
                    {p.referenceNumber && (
                      <p className="text-xs text-muted-foreground">{p.referenceNumber}</p>
                    )}
                  </TD>
                  <TD priority="secondary" className="text-sm">
                    <Link href={`/accounts/${p.account?.id}`} className="hover:underline">
                      {p.account?.name}
                    </Link>
                  </TD>
                  <TD priority="secondary" className="whitespace-nowrap text-sm">{formatDate(p.paymentDate)}</TD>
                  <TD priority="tertiary" className="text-sm text-muted-foreground">{humanize(p.paymentMethod)}</TD>
                  <TD className="text-right font-medium tabular">{formatMoney(p.amount, p.currencyCode)}</TD>
                  <TD priority="tertiary" className="text-right tabular">
                    {Number(p.unallocatedAmount) > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {formatMoney(p.unallocatedAmount, p.currencyCode)}
                      </span>
                    ) : "—"}
                  </TD>
                  <TD priority="tertiary" className="text-sm">
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
