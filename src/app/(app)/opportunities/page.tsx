import Link from "next/link";
import { Prisma } from "@prisma/client";
import { Handshake, Plus } from "lucide-react";
import { listOpportunities, getPipelineByStage } from "@/server/opportunities";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Input, Select, Button,
} from "@/components/ui";
import { formatMoney, formatCompactMoney, formatDate, humanize } from "@/lib/utils";

const STAGES = [
  "DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED",
  "QUOTE_SUBMITTED", "NEGOTIATION", "VERBAL_CONFIRMATION",
  "CLOSED_WON", "CLOSED_LOST", "ON_HOLD",
];

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; search?: string }>;
}) {
  const params = await searchParams;
  const [deals, pipeline] = await Promise.all([
    listOpportunities(params),
    getPipelineByStage(),
  ]);

  const open = pipeline.filter((p) => !["CLOSED_WON", "CLOSED_LOST"].includes(p.stage));
  const openTotal = open.reduce((s, p) => s.plus(p.total), new Prisma.Decimal(0));
  const weighted = deals
    .filter((d) => !["CLOSED_WON", "CLOSED_LOST"].includes(d.stage))
    .reduce(
      (s, d) =>
        s.plus(new Prisma.Decimal(d.amount).times(d.probabilityPercent).dividedBy(100)),
      new Prisma.Decimal(0),
    );
  const partnerSourced = deals.filter((d) => d.partners.length > 0).length;

  return (
    <>
      <PageHeader title="Opportunities" description="Your live pipeline, including which deals a partner brought in.">
        <Button asChild>
          <Link href="/opportunities/new">
            <Plus className="h-4 w-4" /> New opportunity
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open pipeline" value={formatCompactMoney(openTotal)} sublabel={`${open.reduce((s, p) => s + p.count, 0)} deals`} />
        <StatTile label="Weighted forecast" value={formatCompactMoney(weighted)} sublabel="Amount x probability" tone="info" />
        <StatTile
          label="Won"
          value={formatCompactMoney(pipeline.find((p) => p.stage === "CLOSED_WON")?.total ?? 0)}
          tone="success"
        />
        <StatTile label="Partner-sourced" value={String(partnerSourced)} sublabel={`of ${deals.length} deals shown`} />
      </div>

      <Card className="mt-6">
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <div className="min-w-[220px] flex-1">
            <Input name="search" placeholder="Search deal, number or customer…" defaultValue={params.search} />
          </div>
          <Select name="stage" defaultValue={params.stage ?? ""} className="w-52">
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        {deals.length === 0 ? (
          <EmptyState
            title="No opportunities match"
            description="Convert a qualified lead, or create a deal directly against an account."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Deal</TH>
                <TH>Customer</TH>
                <TH>Owner</TH>
                <TH>Partner</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Prob.</TH>
                <TH>Close date</TH>
                <TH>Stage</TH>
              </TR>
            </THead>
            <TBody>
              {deals.map((d) => {
                const overdue =
                  d.expectedCloseDate < new Date() &&
                  !["CLOSED_WON", "CLOSED_LOST"].includes(d.stage);

                return (
                  <TR key={d.id}>
                    <TD>
                      <Link href={`/opportunities/${d.id}`} className="font-medium hover:underline">
                        {d.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{d.opportunityNumber}</p>
                    </TD>
                    <TD className="text-sm">
                      <Link href={`/accounts/${d.account.id}`} className="hover:underline">
                        {d.account.name}
                      </Link>
                    </TD>
                    <TD className="text-sm text-muted-foreground">{d.owner.fullName}</TD>
                    <TD>
                      {d.partners.length === 0 ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Handshake className="h-3.5 w-3.5 text-muted-foreground" />
                          <Link
                            href={`/partners/${d.partners[0].partner.id}`}
                            className="text-sm hover:underline"
                          >
                            {d.partners[0].partner.displayName}
                          </Link>
                          {d.partners.length > 1 && (
                            <span className="text-xs text-muted-foreground">+{d.partners.length - 1}</span>
                          )}
                        </div>
                      )}
                    </TD>
                    <TD className="text-right font-medium tabular">
                      {formatMoney(d.amount, d.currencyCode)}
                    </TD>
                    <TD className="text-right tabular text-muted-foreground">
                      {Number(d.probabilityPercent).toFixed(0)}%
                    </TD>
                    <TD className={`text-sm ${overdue ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatDate(d.expectedCloseDate)}
                    </TD>
                    <TD>
                      <Badge tone={statusTone(d.stage)}>{humanize(d.stage)}</Badge>
                    </TD>
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
