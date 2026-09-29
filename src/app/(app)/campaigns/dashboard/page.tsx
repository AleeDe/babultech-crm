import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getMarketingDashboard, type AttributionModel } from "@/server/marketing";
import { listCampaigns } from "@/server/crm";
import { getAssignableUsers } from "@/server/bulk";
import { supabaseServer } from "@/lib/supabase";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, StatTile, Forbidden, Input, Select, Button, Badge, statusTone,
} from "@/components/ui";
import { FilterForm } from "@/components/filter-form";
import { formatMoney, formatMoneyTotal, formatPercent, humanize } from "@/lib/utils";
import { ATTRIBUTION_MODELS } from "@/lib/marketing";

const MODELS = ATTRIBUTION_MODELS.map((m) => m.value) as string[];

export default async function MarketingDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; typeId?: string; ownerId?: string; parentId?: string; status?: string; model?: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_READ)) return <Forbidden what="the marketing dashboard" />;
  const params = await searchParams;
  const model = (MODELS.includes(params.model ?? "") ? params.model : "PRIMARY") as AttributionModel;
  const db = await supabaseServer();
  const [{ rows, totals }, campaigns, users, { data: types }] = await Promise.all([
    getMarketingDashboard({ ...params, model }),
    listCampaigns(),
    getAssignableUsers(),
    db.from("campaign_type").select("id, name").order("name"),
  ]);
  const modelLabel = ATTRIBUTION_MODELS.find((m) => m.value === model)!.label;

  return (
    <>
      <PageHeader
        backTo="/campaigns"
        backLabel="Back to campaigns"
        title="Marketing dashboard"
        description="Every campaign from first touch to won revenue, child campaigns added into their parent. Dates narrow when the members, touches, leads and deals were created."
      />

      <Card className="mb-6">
        <FilterForm className="flex flex-wrap items-end gap-3 p-4">
          <label className="text-xs text-muted-foreground">From<Input name="from" type="date" defaultValue={params.from} className="mt-1 w-40" /></label>
          <label className="text-xs text-muted-foreground">To<Input name="to" type="date" defaultValue={params.to} className="mt-1 w-40" /></label>
          <Select name="typeId" defaultValue={params.typeId ?? ""} className="w-44" aria-label="Type">
            <option value="">Every type</option>
            {(types ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select name="ownerId" defaultValue={params.ownerId ?? ""} className="w-44" aria-label="Owner">
            <option value="">Every owner</option>
            {users.map((u: { id: string; fullName: string }) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
          <Select name="parentId" defaultValue={params.parentId ?? ""} className="w-52" aria-label="Parent campaign">
            <option value="">Top-level campaigns</option>
            {(campaigns as { id: string; name: string }[]).map((c) => <option key={c.id} value={c.id}>Inside {c.name}</option>)}
          </Select>
          <Select name="status" defaultValue={params.status ?? ""} className="w-40" aria-label="Status">
            <option value="">Any status</option>
            {["PLANNED", "ACTIVE", "PAUSED", "COMPLETED"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          <Select name="model" defaultValue={model} className="w-48" aria-label="Credit deals by">
            {ATTRIBUTION_MODELS.map((m) => <option key={m.value} value={m.value}>Credit: {m.label}</option>)}
          </Select>
          <Button type="button" variant="secondary">Apply</Button>
        </FilterForm>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Spend" value={formatMoneyTotal(totals.cost)} sublabel={totals.budget ? `of ${formatMoney(totals.budget)} budget` : undefined} />
        <StatTile label="Prospects & leads" value={String(totals.prospects)} sublabel={`${totals.engaged} engaged · ${totals.members} members`} />
        <StatTile label="Won revenue" value={formatMoneyTotal(totals.wonRevenue)} sublabel={`${totals.won} won · credited by ${modelLabel.toLowerCase()}`} tone="success" />
        <StatTile label="Open pipeline" value={formatMoneyTotal(totals.pipeline)} sublabel={`${totals.deals} deals`} tone="info" />
        <StatTile
          label="ROI"
          value={totals.roiPercent === null ? "—" : formatPercent(totals.roiPercent, 0)}
          sublabel={totals.costPerLead === null ? "No spend recorded" : `${formatMoney(totals.costPerLead)} per lead`}
          tone={totals.roiPercent === null ? "neutral" : totals.roiPercent >= 0 ? "success" : "danger"}
        />
      </div>

      <Card className="mt-6">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No campaigns match.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Campaign</TH>
                <TH className="text-right">Members</TH>
                <TH className="text-right" priority="secondary">Engaged</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right" priority="secondary">Qualified</TH>
                <TH className="text-right">Won</TH>
                <TH className="text-right">Revenue</TH>
                <TH className="text-right" priority="secondary">Spend</TH>
                <TH className="text-right">ROI</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="text-sm">
                    <Link href={`/campaigns/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    <p className="text-xs text-muted-foreground">
                      <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>{" "}
                      {[r.typeName, r.ownerName].filter(Boolean).join(" · ")}
                      {r.childCount > 0 && (
                        <>
                          {" · "}
                          <Link href={`/campaigns/dashboard?parentId=${r.id}&model=${model}`} className="hover:underline">
                            {r.childCount} child campaign{r.childCount === 1 ? "" : "s"}
                          </Link>
                        </>
                      )}
                    </p>
                  </TD>
                  <TD className="text-right text-sm tabular-nums">{r.members}</TD>
                  <TD className="text-right text-sm tabular-nums" priority="secondary">{r.engaged}</TD>
                  <TD className="text-right text-sm tabular-nums">{r.prospects}</TD>
                  <TD className="text-right text-sm tabular-nums" priority="secondary">{r.qualified}</TD>
                  <TD className="text-right text-sm tabular-nums">{r.won}</TD>
                  <TD className="text-right text-sm tabular-nums">{formatMoney(r.wonRevenue)}</TD>
                  <TD className="text-right text-sm tabular-nums" priority="secondary">{formatMoney(r.cost)}</TD>
                  <TD className="text-right text-sm tabular-nums">{r.roiPercent === null ? "—" : formatPercent(r.roiPercent, 0)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
