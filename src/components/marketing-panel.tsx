import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle, DetailRow } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { interactionLabel } from "@/lib/marketing";
import { getTracking, listTouches } from "@/server/marketing";
import { listCampaigns } from "@/server/crm";
import { LogTouchButton } from "./log-touch-button";
import { ReferredByPicker } from "./referred-by-picker";

/**
 * On a lead or contact: where they came from - first and latest touch, UTM
 * tags, who referred them, their score - and every campaign touch, with a way
 * to log one by hand.
 */
export async function MarketingPanel({
  entity,
  id,
  canWrite,
  defaultCampaignId,
}: {
  entity: "Lead" | "Contact";
  id: string;
  canWrite: boolean;
  defaultCampaignId?: string | null;
}) {
  const [tracking, touches, campaigns] = await Promise.all([
    getTracking(entity, id).catch(() => null),
    listTouches(entity === "Lead" ? { leadId: id } : { contactId: id }, 30).catch(() => []),
    canWrite ? listCampaigns().catch(() => []) : Promise.resolve([]),
  ]);
  if (!tracking) return null;

  const touch = (t: typeof tracking.first, label: string) => (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <DetailRow label="Source">{[t.source, t.medium].filter(Boolean).join(" / ") || "—"}</DetailRow>
      <DetailRow label="Campaign">
        {t.campaign ? <Link href={`/campaigns/${t.campaign.id}`} className="text-primary hover:underline">{t.campaign.name}</Link> : "—"}
      </DetailRow>
      {entity === "Lead" && <DetailRow label="Landing page"><span className="break-all">{t.landingPage ?? "—"}</span></DetailRow>}
      {entity === "Lead" && <DetailRow label="Referrer"><span className="break-all">{t.referrer ?? "—"}</span></DetailRow>}
      <DetailRow label="When">{t.at ? formatDateTime(t.at) : "—"}</DetailRow>
    </div>
  );

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Where they came from</CardTitle>
          {tracking.score !== null && (
            <Badge tone={tracking.score >= 50 ? "success" : tracking.score >= 20 ? "info" : "neutral"}>Score {tracking.score}</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          <div className="grid gap-5 sm:grid-cols-2">
            {touch(tracking.first, "First touch")}
            {touch(tracking.latest, "Latest touch")}
          </div>
          {tracking.utm && (
            <p className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs">
              {Object.entries(tracking.utm)
                .filter(([, v]) => v)
                .map(([k, v]) => `utm_${k}=${v}`)
                .join("  ")}
            </p>
          )}
          {entity === "Lead" && (
            <DetailRow label="Referred by">
              <ReferredByPicker leadId={id} current={tracking.referredByContact} canWrite={canWrite} />
            </DetailRow>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Campaign touches</CardTitle>
          {canWrite && (
            <LogTouchButton
              leadId={entity === "Lead" ? id : null}
              contactId={entity === "Contact" ? id : null}
              campaigns={(campaigns as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }))}
              defaultCampaignId={defaultCampaignId ?? null}
            />
          )}
        </CardHeader>
        <CardContent>
          {touches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No campaign touches yet. Website forms and email opens and clicks are logged here by themselves.
            </p>
          ) : (
            <ul className="space-y-3">
              {touches.map((t) => (
                <li key={t.id} className="border-b pb-3 text-sm last:border-0 last:pb-0">
                  <p className="font-medium">{interactionLabel(t.interactionType)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(t.occurredAt)}
                    {t.campaign && (
                      <>
                        {" · "}
                        <Link href={`/campaigns/${t.campaign.id}`} className="hover:underline">{t.campaign.name}</Link>
                      </>
                    )}
                    {t.createdByName ? ` · ${t.createdByName}` : ""}
                  </p>
                  {t.details && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{t.details}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
