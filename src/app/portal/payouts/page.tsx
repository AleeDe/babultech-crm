import { getPortalPayouts } from "@/server/portal";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Alert,
} from "@/components/ui";
import { formatMoney, formatDate, humanize } from "@/lib/utils";

export default async function PortalPayoutsPage() {
  const payouts = await getPortalPayouts();

  const currency = payouts[0]?.currencyCode ?? "PKR";
  const paid = payouts.filter((p) => p.status === "PAID");
  const paidTotal = paid.reduce((s, p) => s + Number(p.netAmount), 0);
  const inFlight = payouts.filter((p) => !["PAID", "CANCELLED"].includes(p.status));
  const inFlightTotal = inFlight.reduce((s, p) => s + Number(p.netAmount), 0);
  const taxTotal = payouts.reduce((s, p) => s + Number(p.withholdingTaxAmount), 0);

  return (
    <>
      <PageHeader
        title="Payouts"
        description="Commission is batched into a payout, approved, then paid. This is the money that actually reaches your bank."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Paid to date" value={formatMoney(paidTotal, currency)} tone="success" sublabel={`${paid.length} payout(s)`} />
        <StatTile
          label="In progress"
          value={formatMoney(inFlightTotal, currency)}
          sublabel={`${inFlight.length} awaiting payment`}
          tone={inFlight.length ? "warning" : "neutral"}
        />
        <StatTile label="Withholding tax" value={formatMoney(taxTotal, currency)} sublabel="Deducted at source" />
        <StatTile label="Total payouts" value={String(payouts.length)} />
      </div>

      <Card className="mt-6">
        {payouts.length === 0 ? (
          <EmptyState
            title="No payouts yet"
            description="Once approved commission is batched for payment, the batch shows up here with its reference."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Payout</TH>
                <TH>Period</TH>
                <TH className="text-right">Records</TH>
                <TH className="text-right">Gross</TH>
                <TH className="text-right">Tax</TH>
                <TH className="text-right">Net paid</TH>
                <TH>Paid on</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {payouts.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <span className="font-mono text-xs">{p.payoutNumber}</span>
                    {p.referenceNumber && (
                      <p className="text-xs text-muted-foreground">Ref {p.referenceNumber}</p>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-sm text-muted-foreground">
                    {p.periodStart || p.periodEnd
                      ? `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`
                      : "—"}
                  </TD>
                  <TD className="text-right tabular">{p._count.records}</TD>
                  <TD className="text-right tabular">{formatMoney(p.grossAmount, p.currencyCode)}</TD>
                  <TD className="text-right tabular text-muted-foreground">
                    −{formatMoney(p.withholdingTaxAmount, p.currencyCode)}
                  </TD>
                  <TD className="text-right font-medium tabular">
                    {formatMoney(p.netAmount, p.currencyCode)}
                  </TD>
                  <TD className="whitespace-nowrap text-sm">{formatDate(p.paymentDate)}</TD>
                  <TD><Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="mt-4">
        <Alert tone="info">
          Withholding tax is deducted before payment and remitted on your behalf. The net figure is
          what leaves our bank.
        </Alert>
      </div>
    </>
  );
}
