import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { formatMoney, formatMoneyTotal, formatPercent, formatDateTime } from "@/lib/utils";
import { ATTRIBUTION_MODELS, interactionLabel } from "@/lib/marketing";
import { getCampaignFunnel, listTouches, type AttributionModel } from "@/server/marketing";

/**
 * A campaign's funnel - members through to won deals - with its return, for
 * this campaign and every child campaign beneath it. Revenue is shown under
 * each attribution model, since which campaign "earned" a deal depends on
 * which question is being asked.
 */
export async function CampaignFunnel({ campaignId }: { campaignId: string }) {
  const models = ATTRIBUTION_MODELS.map((m) => m.value as AttributionModel);
  const results = await Promise.all(models.map((m) => getCampaignFunnel(campaignId, m).catch(() => null)));
  const f = results[0];
  if (!f) return null;

  const steps = [
    { label: "Members", value: f.members, help: "People on the campaign's lists" },
    { label: "Engaged", value: f.engaged, help: "Did something: a form, a click, an event" },
    { label: "Prospects & leads", value: f.prospects, help: "Leads made from it, prospects included" },
    { label: "Leads", value: f.leads, help: "Past the prospect stage" },
    { label: "Qualified", value: f.qualified, help: "Qualified, in discovery or converted" },
    { label: "Deals", value: f.deals, help: "Deals with it as primary campaign" },
    { label: "Won", value: f.won, help: "Of those, won" },
  ];
  const top = Math.max(1, ...steps.map((s) => s.value));

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Funnel and return</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {f.childCount > 0
            ? `This campaign and its ${f.childCount} child campaign${f.childCount === 1 ? "" : "s"}, added together.`
            : "This campaign alone."}
        </p>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <ol className="space-y-2">
          {steps.map((s, i) => {
            const prev = i > 0 ? steps[i - 1].value : null;
            const rate = prev ? Math.round((s.value / prev) * 100) : null;
            return (
              <li key={s.label} title={s.help}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{s.label}</span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{s.value}</span>
                    {rate !== null && <span className="ml-2 text-xs text-muted-foreground">{rate}%</span>}
                  </span>
                </div>
                <div className="mt-1 h-2 rounded bg-muted">
                  <div className="h-2 rounded bg-primary" style={{ width: `${Math.max(2, (s.value / top) * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Spend</p>
              <p className="font-semibold">{formatMoneyTotal(f.cost)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ROI (primary)</p>
              <p className="font-semibold">{f.roiPercent === null ? "—" : formatPercent(f.roiPercent, 0)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cost per lead</p>
              <p className="font-semibold">{f.costPerLead === null ? "—" : formatMoney(f.costPerLead)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cost per won deal</p>
              <p className="font-semibold">{f.costPerWon === null ? "—" : formatMoney(f.costPerWon)}</p>
            </div>
          </div>
          <Table>
            <THead>
              <TR>
                <TH>Credited by</TH>
                <TH className="text-right">Deals</TH>
                <TH className="text-right">Won</TH>
                <TH className="text-right">Revenue won</TH>
              </TR>
            </THead>
            <TBody>
              {ATTRIBUTION_MODELS.map((m, i) => {
                const r = results[i];
                return (
                  <TR key={m.value}>
                    <TD className="text-sm" title={m.help}>{m.label}</TD>
                    <TD className="text-right text-sm tabular-nums">{r?.deals ?? "—"}</TD>
                    <TD className="text-right text-sm tabular-nums">{r?.won ?? "—"}</TD>
                    <TD className="text-right text-sm tabular-nums">{r ? formatMoney(r.wonRevenue) : "—"}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/** The latest touches on a campaign, from forms, email tracking and people. */
export async function CampaignTouches({ campaignId }: { campaignId: string }) {
  const touches = await listTouches({ campaignId }, 25).catch(() => []);
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Latest touches</CardTitle>
      </CardHeader>
      <CardContent>
        {touches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet. Form submissions, email opens and clicks, and touches logged on leads show here.</p>
        ) : (
          <ul className="space-y-2">
            {touches.map((t) => {
              const person = t.lead ? { href: `/leads/${t.lead.id}`, name: t.lead.name } : t.contact ? { href: `/contacts/${t.contact.id}`, name: t.contact.name } : null;
              return (
                <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 text-sm last:border-0">
                  <span>
                    {person ? <Link href={person.href} className="font-medium hover:underline">{person.name}</Link> : "Someone"}
                    <span className="text-muted-foreground"> · {interactionLabel(t.interactionType)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(t.occurredAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
