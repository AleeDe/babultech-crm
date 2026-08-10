import Link from "next/link";
import { listPayouts } from "@/server/commissions";
import { prisma } from "@/lib/prisma";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, EmptyState, Button, Forbidden
} from "@/components/ui";
import { formatMoney, formatDate, humanize, serialize } from "@/lib/utils";
import { PayoutActions } from "./payout-actions";

export default async function PayoutsPage() {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.COMMISSION_READ)) return <Forbidden what="commission payouts" />;

  const [payouts, bankAccounts] = await Promise.all([
    listPayouts(),
    prisma.bankAccount.findMany({
      where: { active: true },
      select: { id: true, name: true, currencyCode: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const drafts = payouts.filter((p) => p.status === "DRAFT" || p.status === "APPROVED");
  const settled = payouts.filter((p) => p.status === "PAID" || p.status === "CANCELLED");

  return (
    <>
      <PageHeader
        title="Commission payouts"
        description="Batched partner payments. Approving then paying a batch posts an outgoing cash transaction."
      >
        <Button asChild variant="outline">
          <Link href="/commissions">Back to ledger</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Awaiting action ({drafts.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {drafts.length === 0 ? (
            <div className="px-5">
              <EmptyState
                title="Nothing to pay right now"
                description="Approve commissions in the ledger, then batch them into a payout."
                action={
                  <Button asChild>
                    <Link href="/commissions">Open the ledger</Link>
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="divide-y">
              {drafts.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{p.payoutNumber}</span>
                      <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
                    </div>
                    <Link href={`/partners/${p.partner.id}`} className="mt-1 block text-sm font-medium hover:underline">
                      {p.partner.displayName}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {p._count.records} commission{p._count.records === 1 ? "" : "s"}
                      {p.periodStart && ` · ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`}
                      {p.approvedBy && ` · approved by ${p.approvedBy.fullName}`}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-semibold tabular">
                      {formatMoney(p.netAmount, p.currencyCode)}
                    </p>
                    <p className="text-xs text-muted-foreground tabular">
                      {formatMoney(p.grossAmount, p.currencyCode)} gross −{" "}
                      {formatMoney(p.withholdingTaxAmount, p.currencyCode)} tax
                    </p>
                  </div>

                  <div className="w-full sm:w-auto">
                    <PayoutActions payout={serialize(p) as never} bankAccounts={bankAccounts} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Settled ({settled.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {settled.length === 0 ? (
            <p className="px-5 pb-2 text-sm text-muted-foreground">No completed payouts yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Payout</TH>
                  <TH>Partner</TH>
                  <TH>Paid</TH>
                  <TH>Method</TH>
                  <TH>Reference</TH>
                  <TH className="text-right">Records</TH>
                  <TH className="text-right">Net paid</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {settled.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-mono text-xs">{p.payoutNumber}</TD>
                    <TD>
                      <Link href={`/partners/${p.partner.id}`} className="text-sm hover:underline">
                        {p.partner.displayName}
                      </Link>
                    </TD>
                    <TD className="text-sm">{formatDate(p.paymentDate)}</TD>
                    <TD className="text-sm">{p.paymentMethod ? humanize(p.paymentMethod) : "—"}</TD>
                    <TD className="text-sm text-muted-foreground">{p.referenceNumber ?? "—"}</TD>
                    <TD className="text-right tabular">{p._count.records}</TD>
                    <TD className="text-right font-medium tabular">
                      {formatMoney(p.netAmount, p.currencyCode)}
                    </TD>
                    <TD>
                      <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
