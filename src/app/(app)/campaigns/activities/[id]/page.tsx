import { notFound } from "next/navigation";
import Link from "next/link";
import { getCampaignActivity, getActivityAudience, getActivityStats } from "@/server/campaign-activities";
import { getPicklistMap } from "@/server/picklists";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { Pencil } from "lucide-react";
import {
  PageHeader, Forbidden, Badge, Button, StatTile, Alert,
  Card, CardHeader, CardTitle, CardContent,
} from "@/components/ui";
import { formatDateTime, humanize } from "@/lib/utils";
import { AudiencePanel } from "./audience-panel";
import { ActivityActions } from "./activity-actions";

/** Which outcome list a type uses. Email outcomes come from the provider. */
const OUTCOME_LIST: Record<string, string> = {
  CALL: "call_outcome",
  WEBINAR: "webinar_outcome",
  EVENT: "webinar_outcome",
};

export default async function CampaignActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_READ)) return <Forbidden what="campaigns" />;

  const { id } = await params;
  const [activity, audience, stats, picklists] = await Promise.all([
    getCampaignActivity(id),
    getActivityAudience(id),
    getActivityStats(id),
    getPicklistMap().catch(() => ({})),
  ]);

  if (!activity) notFound();

  const lists = picklists as Record<string, { value: string; label: string }[]>;
  const outcomeOptions = lists[OUTCOME_LIST[activity.activityType] ?? ""] ?? [];
  const isEmail = activity.activityType === "EMAIL";
  // Once it has run, nothing about it is editable any more.
  const isLocked = ["RUNNING", "COMPLETED"].includes(activity.status);

  // Rates are worked out against what was actually delivered, not against the
  // whole audience: counting an open against somebody whose address bounced
  // makes the number smaller for no reason anybody can act on.
  const base = stats.delivered || stats.sent;
  const rate = (n: number) => (base ? `${Math.round((n / base) * 100)}%` : "—");

  return (
    <>
      <PageHeader
        backTo={`/campaigns/${activity.campaignId}`}
        backLabel="Back to the campaign"
        title={activity.name}
        description={activity.campaign?.name ?? undefined}
      >
        <Badge tone="neutral">{humanize(activity.activityType)}</Badge>
        <Badge tone={activity.status === "COMPLETED" ? "success" : activity.status === "CANCELLED" ? "neutral" : "info"}>
          {humanize(activity.status)}
        </Badge>
        {can(me, PERMISSIONS.LEAD_WRITE) && (
          <ActivityActions
            id={activity.id}
            name={activity.name}
            campaignId={activity.campaignId}
            status={activity.status}
          />
        )}
      </PageHeader>

      {isEmail && stats.sent > 0 && (
        <div className="mb-5">
          <Alert tone="info">
            <span className="font-medium">About the open rate.</span> An open is counted when the
            mail program loads a tracking image. Apple Mail loads it whether or not anyone read the
            message, and people who block images never register at all — so treat opens as
            direction, and clicks as the real measure.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Audience" value={String(stats.audience)} />
        {isEmail ? (
          <>
            <StatTile label="Delivered" value={String(stats.delivered || stats.sent)} sublabel={`${stats.sent} sent`} tone="info" />
            <StatTile label="Opened" value={String(stats.opened)} sublabel={rate(stats.opened)} tone={stats.opened ? "success" : "neutral"} />
            <StatTile label="Clicked" value={String(stats.clicked)} sublabel={rate(stats.clicked)} tone={stats.clicked ? "success" : "neutral"} />
          </>
        ) : (
          <>
            <StatTile label="Recorded" value={String(stats.recorded)} sublabel={`of ${stats.audience}`} tone="info" />
            {stats.outcomes.slice(0, 2).map((o) => (
              <StatTile key={o.outcome} label={humanize(o.outcome)} value={String(o.count)} />
            ))}
          </>
        )}
      </div>

      {isEmail && (stats.bounced > 0 || stats.unsubscribed > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {stats.bounced > 0 && (
            <StatTile label="Bounced" value={String(stats.bounced)} sublabel="Addresses now skipped" tone="danger" />
          )}
          {stats.unsubscribed > 0 && (
            <StatTile label="Unsubscribed" value={String(stats.unsubscribed)} sublabel="From this email" tone="warning" />
          )}
        </div>
      )}

      {!isEmail && stats.outcomes.length > 2 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>How it went</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-3">
              {stats.outcomes.map((o) => (
                <li key={o.outcome} className="flex items-baseline justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{humanize(o.outcome)}</span>
                  <span className="font-medium tabular">{o.count}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {isEmail && (
        <Card className="mt-6">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <CardTitle>The email</CardTitle>
            {can(me, PERMISSIONS.LEAD_WRITE) && !isLocked && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/campaigns/activities/${activity.id}/edit`}>
                  <Pencil className="h-4 w-4" /> Edit the email
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Subject: </span>
              <span className="font-medium">{activity.subject ?? "Not set"}</span>
            </p>
            {activity.replyTo && (
              <p><span className="text-muted-foreground">Replies go to: </span>{activity.replyTo}</p>
            )}
            {activity.bodyText ? (
              <pre className="mt-3 whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-sans text-sm">
                {activity.bodyText}
              </pre>
            ) : (
              <p className="text-muted-foreground">
                No message written yet. It cannot be sent until there is one.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="mt-6">
        <AudiencePanel
          activityId={activity.id}
          activityType={activity.activityType}
          status={activity.status}
          audience={audience}
          outcomeOptions={outcomeOptions}
        />
      </div>

      {activity.completedAt && (
        <p className="mt-4 text-xs text-muted-foreground">
          Ran {formatDateTime(activity.completedAt)}.
        </p>
      )}
    </>
  );
}
