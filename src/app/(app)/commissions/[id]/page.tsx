import Link from "next/link";
import { notFound } from "next/navigation";
import { getCommission } from "@/server/commissions";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  StatTile, DetailRow, Alert, Forbidden,
} from "@/components/ui";
import { formatMoney, formatDate, formatDateTime, formatPercent, humanize } from "@/lib/utils";

export default async function CommissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.COMMISSION_READ)) return <Forbidden what="commission" />;

  const { id } = await params;
  const commission = await getCommission(id);
  if (!commission) notFound();

  const gross = Number(commission.commissionAmount ?? 0);
  const withheld = Number(commission.withholdingTaxAmount ?? 0);
  const net = Number(commission.netPayableAmount ?? 0);

  return (
    <>
      <PageHeader
        backTo="/commissions"
        backLabel="Back to commissions"
        title={commission.commissionNumber}
        description={`${commission.partner?.displayName ?? "Unknown partner"} · earned ${formatDate(commission.earnedDate)}`}
      >
        <Badge tone={statusTone(commission.status)}>{humanize(commission.status)}</Badge>
      </PageHeader>

      {commission.status === "REJECTED" && commission.rejectionReason && (
        <div className="mb-5">
          <Alert tone="danger">
            <p className="font-medium">Rejected</p>
            <p className="mt-0.5 text-sm">{commission.rejectionReason}</p>
          </Alert>
        </div>
      )}

      {commission.reversesRecordId && (
        <div className="mb-5">
          <Alert tone="warning">
            This is a clawback - it reverses an earlier commission record.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Basis"
          value={formatMoney(commission.basisAmount, commission.currencyCode)}
          sublabel={humanize(commission.basis)}
        />
        <StatTile
          label="Rate"
          value={commission.ratePercent ? formatPercent(commission.ratePercent, 2) : "—"}
          sublabel={commission.plan?.name ?? undefined}
        />
        <StatTile label="Gross" value={formatMoney(gross, commission.currencyCode)} />
        <StatTile
          label="Net payable"
          value={formatMoney(net, commission.currencyCode)}
          sublabel={withheld > 0 ? `after ${formatMoney(withheld, commission.currencyCode)} withheld` : undefined}
          tone="success"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What it was earned on</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Partner">
              {commission.partner ? (
                <Link href={`/partners/${commission.partner?.id}`} className="text-primary hover:underline">
                  {commission.partner?.displayName}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Deal">
              {commission.opportunity ? (
                <Link href={`/opportunities/${commission.opportunity?.id}`} className="text-primary hover:underline">
                  {commission.opportunity?.name}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Customer">{commission.opportunity?.account?.name ?? "—"}</DetailRow>
            <DetailRow label="Invoice">
              {commission.invoice ? (
                <Link href={`/invoices/${commission.invoice?.id}`} className="text-primary hover:underline">
                  {commission.invoice?.invoiceNumber}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Payment">
              {commission.payment ? (
                <Link href={`/payments/${commission.payment?.id}`} className="text-primary hover:underline">
                  {commission.payment?.paymentNumber}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How it was calculated</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Plan">{commission.plan?.name ?? "Partner default rate"}</DetailRow>
            <DetailRow label="Triggered by">
              {commission.plan?.trigger ? humanize(commission.plan?.trigger) : "—"}
            </DetailRow>
            <DetailRow label="Basis amount">
              {formatMoney(commission.basisAmount, commission.currencyCode)}
            </DetailRow>
            <DetailRow label="Withheld">
              {withheld > 0 ? formatMoney(withheld, commission.currencyCode) : "None"}
            </DetailRow>
            <DetailRow label="Payable from">
              {commission.payableFromDate ? formatDate(commission.payableFromDate) : "—"}
            </DetailRow>
            <DetailRow label="Approved by">
              {commission.approvedBy?.fullName ?? "Not approved"}
              {commission.approvedAt && (
                <span className="block text-xs text-muted-foreground">
                  {formatDateTime(commission.approvedAt)}
                </span>
              )}
            </DetailRow>
            <DetailRow label="Payout">
              {commission.payout ? (
                <Link href="/commissions/payouts" className="text-primary hover:underline">
                  {commission.payout?.payoutNumber}
                </Link>
              ) : (
                "Not in a payout yet"
              )}
            </DetailRow>
          </CardContent>
        </Card>
      </div>

      {commission.calculationNotes && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm text-muted-foreground">
              {commission.calculationNotes}
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
