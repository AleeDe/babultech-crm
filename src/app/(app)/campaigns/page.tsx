import Link from "next/link";
import { Plus } from "lucide-react";
import { listCampaigns, getCampaignPerformance } from "@/server/crm";
import { ListFilters, optionsFrom } from "@/components/list-filters";
import {
  PageHeader, Button, Card, CardHeader, CardTitle, CardContent, Table, THead, TBody,
  TR, TH, TD, Badge, statusTone, EmptyState, StatTile, Alert, Forbidden
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, humanize } from "@/lib/utils";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.LEAD_READ)) return <Forbidden what="campaigns" />;

  const params = await searchParams;
  const campaigns = await listCampaigns(params);

  // The ROI view only exists once supabase/schema-sql/02_views.sql has been applied.
  let performance: Awaited<ReturnType<typeof getCampaignPerformance>> = [];
  let viewMissing = false;
  try {
    performance = await getCampaignPerformance();
  } catch {
    viewMissing = true;
  }

  // The view is read whole rather than filtered, so it has to be narrowed to
  // the same campaigns the list above is showing — otherwise a search hides
  // rows in one table and leaves them visible in the other.
  const visibleIds = new Set(campaigns.map((c) => c.id));
  performance = performance.filter((p) => visibleIds.has(p.campaign_id));

  const totalSpend = campaigns.reduce((s, c) => s + Number(c.actualCost ?? 0), 0);
  const totalBudget = campaigns.reduce((s, c) => s + Number(c.budgetAmount ?? 0), 0);
  const totalLeads = campaigns.reduce((s, c) => s + c._count.leads, 0);
  const wonValue = performance.reduce((s, p) => s + Number(p.won_value ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Marketing spend against leads generated, pipeline created and revenue won."
      >
        {can(_me, PERMISSIONS.LEAD_WRITE) && (
          <Button asChild>
            <Link href="/campaigns/new">
              <Plus className="h-4 w-4" /> New campaign
            </Link>
          </Button>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total budget" value={formatMoney(totalBudget)} sublabel={`${campaigns.length} campaigns`} />
        <StatTile label="Actual spend" value={formatMoney(totalSpend)} tone={totalSpend > totalBudget ? "danger" : "neutral"} />
        <StatTile label="Leads generated" value={String(totalLeads)} tone="info" />
        <StatTile label="Won revenue" value={formatMoney(wonValue)} tone="success" />
      </div>

      <div className="mt-6">
        <ListFilters
          searchPlaceholder="Search campaign name or number…"
          searchValue={params.search}
          selects={[
            {
              name: "status",
              allLabel: "All statuses",
              value: params.status,
              options: optionsFrom(["PLANNED", "ACTIVE", "PAUSED", "COMPLETED"]),
            },
          ]}
        />
      </div>

      {viewMissing && (
        <div className="mt-6">
          <Alert tone="warning">
            Campaign ROI is computed by the <code>v_campaign_performance</code> view. Apply{" "}
            <code>supabase/schema-sql/02_views.sql</code> to your database to populate the performance table below.
          </Alert>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Campaigns</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {campaigns.length === 0 ? (
            <div className="px-5">
              <EmptyState title="No campaigns yet" description="Create a campaign to attribute leads and revenue to your marketing." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Campaign</TH>
                  <TH>Type</TH>
                  <TH>Owner</TH>
                  <TH>Period</TH>
                  <TH className="text-right">Budget</TH>
                  <TH className="text-right">Spend</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Deals</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {campaigns.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{c.campaignNumber}</p>
                    </TD>
                    <TD className="text-sm text-muted-foreground">
                      {c.campaignType?.name}
                      {c.campaignType?.channel && <p className="text-xs">{c.campaignType?.channel}</p>}
                    </TD>
                    <TD className="text-sm text-muted-foreground">{c.owner?.fullName}</TD>
                    <TD className="text-sm">
                      {formatDate(c.startDate)} → {formatDate(c.endDate)}
                    </TD>
                    <TD className="text-right tabular">{formatMoney(c.budgetAmount)}</TD>
                    <TD
                      className={`text-right tabular ${
                        Number(c.actualCost ?? 0) > Number(c.budgetAmount ?? 0)
                          ? "text-red-600 dark:text-red-400"
                          : ""
                      }`}
                    >
                      {formatMoney(c.actualCost)}
                    </TD>
                    <TD className="text-right tabular">{c._count.leads}</TD>
                    <TD className="text-right tabular">{c._count.opportunities}</TD>
                    <TD>
                      <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {performance.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Return on investment</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <THead>
                <TR>
                  <TH>Campaign</TH>
                  <TH className="text-right">Spend</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Cost / lead</TH>
                  <TH className="text-right">Converted</TH>
                  <TH className="text-right">Pipeline</TH>
                  <TH className="text-right">Won</TH>
                  <TH className="text-right">ROI</TH>
                </TR>
              </THead>
              <TBody>
                {performance.map((p) => (
                  <TR key={p.campaign_id}>
                    <TD className="text-sm font-medium">
                      <Link href={`/campaigns/${p.campaign_id}`} className="hover:underline">
                        {p.campaign_name}
                      </Link>
                    </TD>
                    <TD className="text-right tabular">{formatMoney(p.actual_cost)}</TD>
                    <TD className="text-right tabular">{Number(p.leads)}</TD>
                    <TD className="text-right tabular">
                      {p.cost_per_lead ? formatMoney(p.cost_per_lead) : "—"}
                    </TD>
                    <TD className="text-right tabular">{Number(p.converted_leads)}</TD>
                    <TD className="text-right tabular">{formatMoney(p.pipeline_value)}</TD>
                    <TD className="text-right font-medium tabular">{formatMoney(p.won_value)}</TD>
                    <TD
                      className={`text-right tabular ${
                        p.roi_percent && Number(p.roi_percent) > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : p.roi_percent
                            ? "text-red-600 dark:text-red-400"
                            : ""
                      }`}
                    >
                      {p.roi_percent === null ? "—" : formatPercent(p.roi_percent, 0)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
