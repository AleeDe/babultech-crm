import Link from "next/link";
import { Plus } from "lucide-react";
import { getPortalDeals } from "@/server/portal";
import { listMyProposals } from "@/server/commission-proposals";
import { RateRequest } from "./rate-request";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent,
  Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Alert, Button,
} from "@/components/ui";
import { ListFilters, optionsFrom } from "@/components/list-filters";
import { formatMoneyPlain as formatMoney, formatDate, formatPercent, humanize, daysBetween } from "@/lib/utils";
import { REGISTRATION_EXPIRY_WARNING_DAYS } from "@/lib/partner-policy";

/** The stages a partner can meaningfully filter by. */
const STAGES = [
  "DISCOVERY", "QUALIFICATION", "PROPOSAL", "NEGOTIATION",
  "ON_HOLD", "CLOSED_WON", "CLOSED_LOST",
] as const;

export default async function PortalDealsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; stage?: string; customer?: string }>;
}) {
  const [allDeals, proposals, params] = await Promise.all([
    getPortalDeals(),
    listMyProposals(),
    searchParams,
  ]);

  // Filtered in memory rather than in the query: a partner's deal list is small
  // by nature, and doing it here keeps getPortalDeals a single shape that every
  // caller - including the Overview - reads the same way.
  const term = params.search?.trim().toLowerCase();
  const deals = allDeals.filter((d) => {
    if (params.stage && d.opportunity?.stage !== params.stage) return false;
    if (params.customer && d.opportunity?.account?.id !== params.customer) return false;
    if (term) {
      const haystack = [
        d.opportunity?.name,
        d.opportunity?.opportunityNumber,
        d.opportunity?.account?.name,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  // Built from the unfiltered list, so choosing a customer never removes the
  // other customers from the dropdown you chose it in.
  const customers = [
    ...new Map(
      allDeals
        .map((d) => d.opportunity?.account)
        .filter((a) => Boolean(a?.id))
        .map((a) => [String(a!.id), { id: String(a!.id), name: String(a!.name) }] as const),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  // The request that matters on a deal is the open one; failing that, the most
  // recent answer, so a partner sees what we said rather than nothing at all.
  // listMyProposals returns newest first, so the first match of each kind wins.
  const requestByDeal = new Map();
  for (const proposal of proposals) {
    const held = requestByDeal.get(proposal.opportunityId);
    if (!held || (held.status !== "PENDING" && proposal.status === "PENDING")) {
      requestByDeal.set(proposal.opportunityId, proposal);
    }
  }

  const currency = deals[0]?.opportunity?.currencyCode ?? "PKR";
  const open = deals.filter((d) => !["CLOSED_WON", "CLOSED_LOST"].includes(d.opportunity?.stage));
  const won = deals.filter((d) => d.opportunity?.stage === "CLOSED_WON");
  const openValue = open.reduce((s, d) => s + Number(d.opportunity?.amount), 0);
  const wonValue = won.reduce((s, d) => s + Number(d.opportunity?.amount), 0);
  const earned = deals.reduce((s, d) => s + Number(d.earnedAmount), 0);

  const expiringRegistrations = deals.filter((d) => {
    if (!d.registrationExpiresAt) return false;
    const days = daysBetween(new Date(), d.registrationExpiresAt);
    return days >= 0 && days <= REGISTRATION_EXPIRY_WARNING_DAYS;
  });

  return (
    <>
      <PageHeader
        title="Opportunities"
        description="The deals you are registered on, your share of each, and what each has earned you."
      >
        <Button asChild>
          <Link href="/portal/deals/new">
            <Plus className="h-4 w-4" /> New opportunity
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open deals" value={String(open.length)} sublabel={formatMoney(openValue, currency)} tone="info" />
        <StatTile label="Won" value={String(won.length)} sublabel={formatMoney(wonValue, currency)} tone="success" />
        <StatTile label="Commission earned" value={formatMoney(earned, currency)} />
        <StatTile
          label="Registrations expiring"
          value={String(expiringRegistrations.length)}
          sublabel={`Within ${REGISTRATION_EXPIRY_WARNING_DAYS} days`}
          tone={expiringRegistrations.length ? "warning" : "neutral"}
        />
      </div>

      {expiringRegistrations.length > 0 && (
        <div className="mt-5">
          <Alert tone="warning">
            {expiringRegistrations.length} deal registration(s) expire within {REGISTRATION_EXPIRY_WARNING_DAYS} days. Once a
            registration lapses, the deal may no longer be credited to you - talk to your partner
            manager before then.
          </Alert>
        </div>
      )}

      <div className="mt-6">
        <ListFilters
          searchPlaceholder="Search deal, number or customer…"
          searchValue={params.search}
          selects={[
            {
              name: "stage",
              allLabel: "All stages",
              value: params.stage,
              options: optionsFrom(STAGES),
            },
            {
              name: "customer",
              allLabel: "All customers",
              value: params.customer,
              className: "w-52",
              options: customers.map((c) => ({ value: c.id, label: c.name })),
            },
          ]}
        />
      </div>

      <Card>
        {deals.length === 0 ? (
          <EmptyState
            title={allDeals.length === 0 ? "No deals registered" : "No deals match"}
            description={
              allDeals.length === 0
                ? "When we attach you to an opportunity - because you sourced it, influenced it, resold it or are delivering it - it appears here."
                : "Nothing matches those filters. Clear them to see all your deals again."
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Deal</TH>
                <TH>Customer</TH>
                <TH>Your role</TH>
                <TH className="text-right">Your share</TH>
                <TH className="text-right">Your rate</TH>
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
                      <span className="text-sm font-medium">{d.opportunity?.name}</span>
                      <p className="text-xs text-muted-foreground">
                        {d.opportunity?.opportunityNumber}
                        {d.registeredAt && ` · registered ${formatDate(d.registeredAt)}`}
                      </p>
                    </TD>
                    <TD className="text-sm">
                      {d.opportunity?.account?.name}
                      {d.opportunity?.account?.industry && (
                        <p className="text-xs text-muted-foreground">{d.opportunity?.account?.industry}</p>
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
                    <TD className="text-right text-sm">
                      {d.commissionPlanName ? (
                        <span className="text-muted-foreground">{d.commissionPlanName}</span>
                      ) : d.effectiveCommissionPercent !== null ? (
                        <>
                          <span className="tabular">{formatPercent(d.effectiveCommissionPercent)}</span>
                          {d.isRateOverridden && (
                            <p className="text-xs text-muted-foreground">agreed for this deal</p>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD className="text-right tabular">
                      {formatMoney(d.opportunity?.amount, d.opportunity?.currencyCode)}
                    </TD>
                    <TD className="text-right font-medium tabular">
                      {Number(d.earnedAmount) > 0
                        ? formatMoney(d.earnedAmount, d.opportunity?.currencyCode)
                        : "—"}
                    </TD>
                    <TD className="whitespace-nowrap text-sm">
                      {formatDate(d.opportunity?.actualCloseDate ?? d.opportunity?.expectedCloseDate)}
                    </TD>
                    <TD><Badge tone={statusTone(d.opportunity?.stage)}>{humanize(d.opportunity?.stage)}</Badge></TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      {deals.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Your rate on each deal</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              What you earn on a deal, and where you think it should be different, ask us. Your
              rate does not change until we agree it.
            </p>
          </CardHeader>
          <CardContent className="divide-y">
            {deals.map((d) => (
              <div key={d.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-medium">{d.opportunity?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.opportunity?.account?.name}
                      {" · "}
                      {formatMoney(d.opportunity?.amount, d.opportunity?.currencyCode)}
                    </p>
                  </div>
                  <p className="text-sm">
                    {d.commissionPlanName ? (
                      <span className="text-muted-foreground">On the {d.commissionPlanName} plan</span>
                    ) : d.effectiveCommissionPercent !== null ? (
                      <>
                        <span className="font-medium tabular">{formatPercent(d.effectiveCommissionPercent)}</span>
                        <span className="text-muted-foreground"> today</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">No rate set</span>
                    )}
                  </p>
                </div>
                <RateRequest
                  opportunityId={d.opportunity.id}
                  dealName={d.opportunity?.name ?? "this deal"}
                  currentPercent={d.effectiveCommissionPercent}
                  proposal={requestByDeal.get(d.opportunity.id) ?? null}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
