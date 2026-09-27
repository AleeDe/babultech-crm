import Link from "next/link";
import { Plus } from "lucide-react";
import { getPortalDeals } from "@/server/portal";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Button,
} from "@/components/ui";
import { ListFilters, optionsFrom } from "@/components/list-filters";
import { formatMoneyPlain as formatMoney, formatDate, formatPercent, humanize } from "@/lib/utils";

/** Every stage a deal can be in. */
const STAGES = [
  "DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED", "QUOTE_SUBMITTED",
  "NEGOTIATION", "VERBAL_CONFIRMATION", "ON_HOLD", "CLOSED_WON", "CLOSED_LOST",
] as const;

export default async function PortalDealsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; stage?: string; customer?: string }>;
}) {
  const [allDeals, params] = await Promise.all([getPortalDeals(), searchParams]);

  // Filtered in memory rather than in the query: a partner's deal list is small
  // by nature, and doing it here keeps getPortalDeals a single shape that every
  // caller - including the Overview - reads the same way.
  const term = params.search?.trim().toLowerCase();
  const deals = allDeals.filter((d) => {
    if (params.stage && d.stage !== params.stage) return false;
    if (params.customer && d.account?.id !== params.customer) return false;
    if (term) {
      const haystack = [d.name, d.opportunityNumber, d.account?.name].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  // Built from the unfiltered list, so choosing a customer never removes the
  // other customers from the dropdown you chose it in.
  const customers = [
    ...new Map(
      allDeals
        .map((d) => d.account)
        .filter((a): a is NonNullable<typeof a> => Boolean(a?.id))
        .map((a) => [a.id, { id: a.id, name: a.name }] as const),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const currency = (deals[0]?.currencyCode as string | undefined) ?? "PKR";
  const isOpen = (stage: unknown) => stage !== "CLOSED_WON" && stage !== "CLOSED_LOST";
  const open = deals.filter((d) => isOpen(d.stage));
  const won = deals.filter((d) => d.stage === "CLOSED_WON");
  const valueOf = (rows: typeof deals) => rows.reduce((s, d) => s + Number(d.amount ?? 0), 0);
  const commissionOf = (rows: typeof deals) =>
    rows.reduce((s, d) => s + (d.commission && d.commission.status !== "REJECTED" ? Number(d.commission.partnerAmount ?? 0) : 0), 0);

  return (
    <>
      <PageHeader
        title="Opportunities"
        description="The deals credited to you, and what each is worth to you."
      >
        <Button asChild>
          <Link href="/portal/deals/new">
            <Plus className="h-4 w-4" /> New opportunity
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open deals" value={String(open.length)} sublabel={formatMoney(valueOf(open), currency)} tone="info" />
        <StatTile label="Won" value={String(won.length)} sublabel={formatMoney(valueOf(won), currency)} tone="success" />
        <StatTile label="Your commission, open deals" value={formatMoney(commissionOf(open), currency)} sublabel="If they are won" />
        <StatTile
          label="Your commission, won deals"
          value={formatMoney(commissionOf(won), currency)}
          sublabel="Paid or owed"
          href="/portal/commissions"
        />
      </div>

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
            title={allDeals.length === 0 ? "No deals yet" : "No deals match"}
            description={
              allDeals.length === 0
                ? "Deals on the customers you bring us appear here, whoever raises them. Add one with New opportunity."
                : "Nothing matches those filters. Clear them to see all your deals again."
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Deal</TH>
                <TH priority="secondary">Customer</TH>
                <TH className="text-right">Deal value</TH>
                <TH priority="tertiary" className="text-right">Your rate</TH>
                <TH className="text-right">Your commission</TH>
                <TH priority="secondary">Close date</TH>
                <TH>Stage</TH>
              </TR>
            </THead>
            <TBody>
              {deals.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <span className="text-sm font-medium">{d.name}</span>
                    <p className="text-xs text-muted-foreground">{d.opportunityNumber}</p>
                  </TD>
                  <TD priority="secondary" className="text-sm">
                    {d.account && (
                      <Link href={`/portal/customers/${d.account.id}`} className="hover:underline">
                        {d.account.name}
                      </Link>
                    )}
                    {d.account?.industry && (
                      <p className="text-xs text-muted-foreground">{d.account.industry}</p>
                    )}
                  </TD>
                  <TD className="text-right tabular">{formatMoney(d.amount, d.currencyCode as string)}</TD>
                  <TD priority="tertiary" className="text-right tabular">
                    {d.commission ? formatPercent(d.commission.percent, 2) : "—"}
                    {d.commission?.requestPending && (
                      <p className="text-xs text-muted-foreground">change requested</p>
                    )}
                  </TD>
                  <TD className="text-right font-medium tabular">
                    {d.commission && d.commission.status !== "REJECTED"
                      ? formatMoney(d.commission.partnerAmount, d.currencyCode as string)
                      : "—"}
                    {d.commission?.status === "PAID" && (
                      <p className="text-xs font-normal text-muted-foreground">paid</p>
                    )}
                  </TD>
                  <TD priority="secondary" className="whitespace-nowrap text-sm">
                    {formatDate((d.actualCloseDate ?? d.expectedCloseDate) as string)}
                  </TD>
                  <TD><Badge tone={statusTone(d.stage as string)}>{humanize(d.stage as string)}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {deals.length > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          To ask for a different rate on a deal, or to say you have been paid, go to{" "}
          <Link href="/portal/commissions" className="text-primary hover:underline">Commission</Link>.
        </p>
      )}
    </>
  );
}
