import { getPortalCommissions } from "@/server/portal";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Select, Button, Alert,
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, humanize } from "@/lib/utils";

const STATUSES = [
  "ACCRUED", "PENDING_APPROVAL", "APPROVED", "PAYABLE", "PAID", "CLAWED_BACK", "REJECTED",
];

export default async function PortalCommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const records = await getPortalCommissions(status);

  const currency = records[0]?.currencyCode ?? "PKR";
  const total = records.reduce((s, r) => s + Number(r.commissionAmount), 0);
  const net = records.reduce((s, r) => s + Number(r.netPayableAmount), 0);
  const tax = records.reduce((s, r) => s + Number(r.withholdingTaxAmount), 0);
  const paid = records.filter((r) => r.status === "PAID").reduce((s, r) => s + Number(r.netPayableAmount), 0);

  return (
    <>
      <PageHeader
        title="Commission"
        description="Every record raised against your deals, and where each one has reached."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Gross" value={formatMoney(total, currency)} sublabel={`${records.length} record(s)`} />
        <StatTile label="Withholding tax" value={formatMoney(tax, currency)} sublabel="Deducted at payout" />
        <StatTile label="Net" value={formatMoney(net, currency)} tone="info" />
        <StatTile label="Already paid" value={formatMoney(paid, currency)} tone="success" />
      </div>

      <Card className="mt-6">
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <Select name="status" defaultValue={status ?? ""} className="w-56">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        {records.length === 0 ? (
          <EmptyState
            title="No commission records"
            description="A record is created when a deal you are attached to reaches the point your plan pays on — usually when the customer pays us."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Deal</TH>
                <TH>Earned</TH>
                <TH className="text-right">Basis</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">Gross</TH>
                <TH className="text-right">Net</TH>
                <TH>Payout</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {records.map((r) => {
                const reversal = Number(r.commissionAmount) < 0;
                return (
                  <TR key={r.id}>
                    <TD className="font-mono text-xs">{r.commissionNumber}</TD>
                    <TD>
                      <span className="text-sm font-medium">{r.opportunity.name}</span>
                      <p className="text-xs text-muted-foreground">
                        {r.opportunity.account.name}
                        {r.invoice && ` · invoice ${r.invoice.invoiceNumber}`}
                      </p>
                    </TD>
                    <TD className="whitespace-nowrap text-sm">{formatDate(r.earnedDate)}</TD>
                    <TD className="text-right tabular text-muted-foreground">
                      {formatMoney(r.basisAmount, r.currencyCode)}
                    </TD>
                    <TD className="text-right tabular text-muted-foreground">
                      {formatPercent(r.ratePercent, 2)}
                    </TD>
                    <TD className={`text-right tabular ${reversal ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatMoney(r.commissionAmount, r.currencyCode)}
                    </TD>
                    <TD className="text-right font-medium tabular">
                      {formatMoney(r.netPayableAmount, r.currencyCode)}
                    </TD>
                    <TD className="text-sm">
                      {r.payout ? (
                        <>
                          <span className="font-mono text-xs">{r.payout.payoutNumber}</span>
                          <p className="text-xs text-muted-foreground">
                            {r.payout.paymentDate ? formatDate(r.payout.paymentDate) : humanize(r.payout.status)}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Not batched</span>
                      )}
                    </TD>
                    <TD><Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge></TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="mt-4">
        <Alert tone="info">
          A negative record is a reversal — commission that was earned and later clawed back,
          usually because the customer refunded or cancelled. The original record stays on your
          statement so the history is never rewritten.
        </Alert>
      </div>
    </>
  );
}
