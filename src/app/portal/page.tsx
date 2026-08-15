import Link from "next/link";
import { getPortalSummary, getPartnerProfile, getPortalCommissions } from "@/server/portal";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  StatTile, Button, Alert, Table, THead, TBody, TR, TH, TD, EmptyState,
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, humanize, daysBetween } from "@/lib/utils";

export default async function PortalHomePage() {
  const [summary, partner, recent] = await Promise.all([
    getPortalSummary(),
    getPartnerProfile(),
    getPortalCommissions(),
  ]);

  const agreementDays = partner.agreementExpiryDate
    ? daysBetween(new Date(), partner.agreementExpiryDate)
    : null;
  const expiringSoon = agreementDays !== null && agreementDays <= 60;

  return (
    <>
      <PageHeader
        title={`Welcome, ${partner.displayName}`}
        description="Your deals, what you have earned, and when it gets paid."
      >
        <Badge tone={statusTone(partner.status)}>{humanize(partner.status)}</Badge>
        <Badge tone="neutral">{humanize(partner.tier)}</Badge>
        <Button asChild>
          <Link href="/portal/register">Register a deal</Link>
        </Button>
      </PageHeader>

      {partner.status !== "ACTIVE" && (
        <div className="mb-5">
          <Alert tone="warning">
            Your partnership is currently {humanize(partner.status).toLowerCase()}. New deal
            registrations may not earn commission — speak to your partner manager.
          </Alert>
        </div>
      )}
      {expiringSoon && agreementDays !== null && (
        <div className="mb-5">
          <Alert tone={agreementDays < 0 ? "danger" : "warning"}>
            {agreementDays < 0
              ? `Your partner agreement expired ${Math.abs(agreementDays)} day(s) ago.`
              : `Your partner agreement expires in ${agreementDays} day(s), on ${formatDate(partner.agreementExpiryDate)}.`}
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Paid to you"
          value={formatMoney(summary.paidTotal, summary.currency)}
          sublabel="Net of withholding tax"
          tone="success"
        />
        <StatTile
          label="Owed to you"
          value={formatMoney(summary.pendingTotal, summary.currency)}
          sublabel={summary.payoutsPending > 0 ? `${summary.payoutsPending} payout(s) in progress` : "Nothing batched yet"}
          tone={Number(summary.pendingTotal) > 0 ? "warning" : "neutral"}
          href="/portal/commissions"
        />
        <StatTile
          label="Total earned"
          value={formatMoney(summary.earnedTotal, summary.currency)}
          sublabel={`${summary.recordCount} commission record(s)`}
        />
        <StatTile
          label="Your deals"
          value={String(summary.dealCount)}
          sublabel="Registered with us"
          href="/portal/deals"
          tone="info"
        />
      </div>

      {Number(summary.clawedBackTotal) < 0 && (
        <div className="mt-5">
          <Alert tone="danger">
            {formatMoney(Math.abs(Number(summary.clawedBackTotal)), summary.currency)} has been
            reversed against your account. Each reversal is listed on your commission page with its
            reason.
          </Alert>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Recent commission</CardTitle>
              <Button asChild variant="outline" size="sm">
                <Link href="/portal/commissions">See all</Link>
              </Button>
            </CardHeader>
            <CardContent className="px-0">
              {recent.length === 0 ? (
                <div className="px-5">
                  <EmptyState
                    title="Nothing earned yet"
                    description="Commission appears here once a deal you are attached to reaches the point your plan pays on."
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Deal</TH>
                      <TH>Earned</TH>
                      <TH className="text-right">Amount</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {recent.slice(0, 8).map((r) => (
                      <TR key={r.id}>
                        <TD>
                          <span className="text-sm font-medium">{r.opportunity?.name}</span>
                          <p className="text-xs text-muted-foreground">
                            {r.opportunity?.account?.name}
                          </p>
                        </TD>
                        <TD className="whitespace-nowrap text-sm">{formatDate(r.earnedDate)}</TD>
                        <TD className="text-right font-medium tabular">
                          {formatMoney(r.netPayableAmount, r.currencyCode)}
                        </TD>
                        <TD><Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>How you are paid</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {partner.commissionPlan ? (
              <>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plan</p>
                  <p className="mt-0.5 font-medium">{partner.commissionPlan.name}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rate</p>
                  <p className="mt-0.5">
                    {partner.commissionPlan.rateType === "TIERED_PERCENT"
                      ? "Tiered — see below"
                      : partner.commissionPlan.rateType === "FIXED_AMOUNT"
                        ? formatMoney(partner.commissionPlan.fixedAmount, partner.payoutCurrencyCode)
                        : formatPercent(partner.commissionPlan.flatPercent, 2)}
                  </p>
                </div>
                {partner.commissionPlan.tiers.length > 0 && (
                  <div className="space-y-1">
                    {partner.commissionPlan.tiers.map((t, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          {formatMoney(t.fromAmount, partner.payoutCurrencyCode)}
                          {t.toAmount ? ` – ${formatMoney(t.toAmount, partner.payoutCurrencyCode)}` : "+"}
                        </span>
                        <span className="tabular">{formatPercent(t.ratePercent, 2)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Paid when</p>
                  <p className="mt-0.5">{humanize(partner.commissionPlan.trigger)}</p>
                </div>
              </>
            ) : (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rate</p>
                <p className="mt-0.5">{formatPercent(partner.defaultCommissionPercent, 2)}</p>
              </div>
            )}

            {partner.withholdingTaxPercent && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Withholding tax
                </p>
                <p className="mt-0.5">
                  {formatPercent(partner.withholdingTaxPercent, 2)} is deducted before payment.
                </p>
              </div>
            )}
            <p className="pt-1 text-xs text-muted-foreground">
              Payouts are made in {partner.payoutCurrencyCode}.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
