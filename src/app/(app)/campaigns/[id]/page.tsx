import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";
import { one } from "@/lib/decimal";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, StatTile, DetailRow, Forbidden
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, humanize } from "@/lib/utils";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.LEAD_READ)) return <Forbidden what="campaigns" />;
  const db = await supabaseServer();

  const { data: campaignRow } = await db
    .from("campaign")
    .select(
      `*,
       campaignType:campaign_type ( * ),
       owner:app_user!campaign_ownerUserId_fkey ( id, fullName ),
       parentCampaign:parentCampaignId ( id, name ),
       leads:lead ( id, leadNumber, firstName, lastName, companyName, status, estimatedValue, createdAt ),
       opportunities:opportunity ( id, opportunityNumber, name, stage, amount, currencyCode, expectedCloseDate, account ( id, name ) ),
       members:campaign_member ( count )`,
    )
    .eq("id", id)
    .maybeSingle();

  type Row = Record<string, unknown>;
  const desc = (a: unknown, b: unknown) => String(b ?? "").localeCompare(String(a ?? ""));

  // PostgREST cannot embed the reverse side of a self-referencing FK, so the
  // child campaigns are a second query.
  const { data: childCampaigns } = await db
    .from("campaign")
    .select("id, name, status")
    .eq("parentCampaignId", id);

  const campaign = campaignRow
    ? {
        ...campaignRow,
        campaignType: one(campaignRow.campaignType as never),
        owner: one(campaignRow.owner as never),
        parentCampaign: one(campaignRow.parentCampaign as never),
        childCampaigns: childCampaigns ?? [],
        leads: ((campaignRow.leads ?? []) as Row[])
          .sort((a, b) => desc(a.createdAt, b.createdAt))
          .slice(0, 50),
        opportunities: ((campaignRow.opportunities ?? []) as Row[])
          .map((o): Row => ({ ...o, account: one(o.account as never) }))
          .sort((a, b) => desc(a.expectedCloseDate, b.expectedCloseDate))
          .slice(0, 50),
        _count: {
          members:
            (campaignRow.members as { count: number }[] | undefined)?.[0]?.count ?? 0,
        },
      }
    : null;

  if (!campaign) notFound();

  const spend = Number(campaign.actualCost ?? 0);
  const converted = campaign.leads.filter((l: Record<string, any>) => l.status === "CONVERTED").length;
  const won = campaign.opportunities.filter((o: Record<string, any>) => o.stage === "CLOSED_WON");
  const wonValue = won.reduce((s: any, o: Record<string, any>) => s + Number(o.amount), 0);
  const pipeline = campaign.opportunities
    .filter((o: Record<string, any>) => !["CLOSED_WON", "CLOSED_LOST"].includes(o.stage))
    .reduce((s: any, o: Record<string, any>) => s + Number(o.amount), 0);
  const roi = spend > 0 ? ((wonValue - spend) / spend) * 100 : null;
  const costPerLead = campaign.leads.length > 0 && spend > 0 ? spend / campaign.leads.length : null;

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={`${campaign.campaignNumber} · ${campaign.campaignType.name}`}
      >
        <Badge tone={statusTone(campaign.status)}>{humanize(campaign.status)}</Badge>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Spend"
          value={formatMoney(campaign.actualCost)}
          sublabel={campaign.budgetAmount ? `of ${formatMoney(campaign.budgetAmount)} budget` : "No budget set"}
          tone={campaign.budgetAmount && spend > Number(campaign.budgetAmount) ? "danger" : "neutral"}
        />
        <StatTile
          label="Leads"
          value={String(campaign.leads.length)}
          sublabel={`${converted} converted${costPerLead ? ` · ${formatMoney(costPerLead)}/lead` : ""}`}
        />
        <StatTile label="Open pipeline" value={formatMoney(pipeline)} sublabel={`${campaign.opportunities.length} deal(s)`} tone="info" />
        <StatTile
          label="ROI"
          value={roi === null ? "—" : formatPercent(roi, 0)}
          sublabel={`${formatMoney(wonValue)} won`}
          tone={roi === null ? "neutral" : roi >= 0 ? "success" : "danger"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Leads generated</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {campaign.leads.length === 0 ? (
                <p className="px-5 pb-2 text-sm text-muted-foreground">No leads attributed to this campaign.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Lead</TH>
                      <TH>Company</TH>
                      <TH className="text-right">Est. value</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {campaign.leads.map((l: Record<string, any>) => (
                      <TR key={l.id}>
                        <TD>
                          <Link href={`/leads/${l.id}/edit`} className="font-medium hover:underline">
                            {l.firstName} {l.lastName}
                          </Link>
                          <p className="text-xs text-muted-foreground">{l.leadNumber}</p>
                        </TD>
                        <TD className="text-sm">{l.companyName ?? "—"}</TD>
                        <TD className="text-right tabular">{formatMoney(l.estimatedValue)}</TD>
                        <TD><Badge tone={statusTone(l.status)}>{humanize(l.status)}</Badge></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Opportunities influenced</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {campaign.opportunities.length === 0 ? (
                <p className="px-5 pb-2 text-sm text-muted-foreground">No deals attributed yet.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Deal</TH>
                      <TH>Customer</TH>
                      <TH className="text-right">Amount</TH>
                      <TH>Stage</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {campaign.opportunities.map((o: Record<string, any>) => (
                      <TR key={o.id}>
                        <TD>
                          <Link href={`/opportunities/${o.id}`} className="font-medium hover:underline">
                            {o.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">{o.opportunityNumber}</p>
                        </TD>
                        <TD className="text-sm">
                          <Link href={`/accounts/${o.account.id}`} className="hover:underline">
                            {o.account.name}
                          </Link>
                        </TD>
                        <TD className="text-right tabular">{formatMoney(o.amount, o.currencyCode)}</TD>
                        <TD><Badge tone={statusTone(o.stage)}>{humanize(o.stage)}</Badge></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Type">{campaign.campaignType.name}</DetailRow>
              <DetailRow label="Owner">{campaign.owner.fullName}</DetailRow>
              <DetailRow label="Runs">
                {formatDate(campaign.startDate)} → {formatDate(campaign.endDate)}
              </DetailRow>
              <DetailRow label="Budget">{formatMoney(campaign.budgetAmount)}</DetailRow>
              <DetailRow label="Expected">
                {campaign.expectedLeads ?? "—"} leads · {formatMoney(campaign.expectedRevenue)}
              </DetailRow>
              <DetailRow label="Members">{campaign._count.members}</DetailRow>
              <DetailRow label="Parent campaign">
                {campaign.parentCampaign ? (
                  <Link href={`/campaigns/${campaign.parentCampaign.id}`} className="text-primary hover:underline">
                    {campaign.parentCampaign.name}
                  </Link>
                ) : "—"}
              </DetailRow>
              {campaign.childCampaigns.length > 0 && (
                <DetailRow label="Sub-campaigns">
                  <div className="space-y-0.5">
                    {campaign.childCampaigns.map((c: Record<string, any>) => (
                      <Link key={c.id} href={`/campaigns/${c.id}`} className="block text-primary hover:underline">
                        {c.name}
                      </Link>
                    ))}
                  </div>
                </DetailRow>
              )}
            </CardContent>
          </Card>

          {campaign.description && (
            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{campaign.description}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
