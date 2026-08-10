import { getPortalDeals } from "@/server/portal";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Alert,
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, humanize, daysBetween } from "@/lib/utils";

export default async function PortalDealsPage() {
  const deals = await getPortalDeals();

  const currency = deals[0]?.opportunity.currencyCode ?? "PKR";
  const open = deals.filter((d) => !["CLOSED_WON", "CLOSED_LOST"].includes(d.opportunity.stage));
  const won = deals.filter((d) => d.opportunity.stage === "CLOSED_WON");
  const openValue = open.reduce((s, d) => s + Number(d.opportunity.amount), 0);
  const wonValue = won.reduce((s, d) => s + Number(d.opportunity.amount), 0);
  const earned = deals.reduce((s, d) => s + Number(d.earnedAmount), 0);

  const expiringRegistrations = deals.filter((d) => {
    if (!d.registrationExpiresAt) return false;
    const days = daysBetween(new Date(), d.registrationExpiresAt);
    return days >= 0 && days <= 30;
  });

  return (
    <>
      <PageHeader
        title="My deals"
        description="Opportunities you are registered on, your share of each, and what it has earned you."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open deals" value={String(open.length)} sublabel={formatMoney(openValue, currency)} tone="info" />
        <StatTile label="Won" value={String(won.length)} sublabel={formatMoney(wonValue, currency)} tone="success" />
        <StatTile label="Commission earned" value={formatMoney(earned, currency)} />
        <StatTile
          label="Registrations expiring"
          value={String(expiringRegistrations.length)}
          sublabel="Within 30 days"
          tone={expiringRegistrations.length ? "warning" : "neutral"}
        />
      </div>

      {expiringRegistrations.length > 0 && (
        <div className="mt-5">
          <Alert tone="warning">
            {expiringRegistrations.length} deal registration(s) expire within 30 days. Once a
            registration lapses, the deal may no longer be credited to you — talk to your partner
            manager before then.
          </Alert>
        </div>
      )}

      <Card className="mt-6">
        {deals.length === 0 ? (
          <EmptyState
            title="No deals registered"
            description="When we attach you to an opportunity — because you sourced it, influenced it, resold it or are delivering it — it appears here."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Deal</TH>
                <TH>Customer</TH>
                <TH>Your role</TH>
                <TH className="text-right">Your share</TH>
                <TH className="text-right">Deal value</TH>
                <TH className="text-right">Earned</TH>
                <TH>Close date</TH>
                <TH>Stage</TH>
              </TR>
            </THead>
            <TBody>
              {deals.map((d) => {
                const regDays = d.registrationExpiresAt
                  ? daysBetween(new Date(), d.registrationExpiresAt)
                  : null;
                const lapsed = regDays !== null && regDays < 0;

                return (
                  <TR key={d.id}>
                    <TD>
                      <span className="text-sm font-medium">{d.opportunity.name}</span>
                      <p className="text-xs text-muted-foreground">
                        {d.opportunity.opportunityNumber}
                        {d.registeredAt && ` · registered ${formatDate(d.registeredAt)}`}
                      </p>
                    </TD>
                    <TD className="text-sm">
                      {d.opportunity.account.name}
                      {d.opportunity.account.industry && (
                        <p className="text-xs text-muted-foreground">{d.opportunity.account.industry}</p>
                      )}
                    </TD>
                    <TD>
                      <Badge tone="neutral">{humanize(d.role)}</Badge>
                      {lapsed && (
                        <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                          Registration lapsed
                        </p>
                      )}
                    </TD>
                    <TD className="text-right tabular">{formatPercent(d.revenueSharePercent, 0)}</TD>
                    <TD className="text-right tabular">
                      {formatMoney(d.opportunity.amount, d.opportunity.currencyCode)}
                    </TD>
                    <TD className="text-right font-medium tabular">
                      {Number(d.earnedAmount) > 0
                        ? formatMoney(d.earnedAmount, d.opportunity.currencyCode)
                        : "—"}
                    </TD>
                    <TD className="whitespace-nowrap text-sm">
                      {formatDate(d.opportunity.actualCloseDate ?? d.opportunity.expectedCloseDate)}
                    </TD>
                    <TD><Badge tone={statusTone(d.opportunity.stage)}>{humanize(d.opportunity.stage)}</Badge></TD>
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
