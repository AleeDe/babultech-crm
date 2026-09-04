import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, Phone, MapPin } from "lucide-react";
import { getActivity } from "@/server/crm";
import { requireUser } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Button, DetailRow, Alert,
} from "@/components/ui";
import { formatDateTime, humanize, entityHref } from "@/lib/utils";

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();

  const { id } = await params;
  const activity = await getActivity(id);
  if (!activity) notFound();

  const overdue =
    activity.status === "OPEN" &&
    activity.dueAt !== null &&
    new Date(activity.dueAt as string) < new Date();

  const relatedHref = entityHref(activity.relatedEntityType, activity.relatedEntityId);

  return (
    <>
      <PageHeader
        backTo="/activities"
        backLabel="Back to activities"
        title={activity.subject} description={humanize(activity.activityType)}>
        <Badge tone={statusTone(activity.status)}>{humanize(activity.status)}</Badge>
        <Badge tone={statusTone(activity.priority)}>{humanize(activity.priority)}</Badge>
        {activity.isMine && (
          <Button asChild variant="outline">
            <Link href={`/activities/${activity.id}/edit`}>Edit</Link>
          </Button>
        )}
      </PageHeader>

      {overdue && (
        <div className="mb-5">
          <Alert tone="danger">
            This was due {formatDateTime(activity.dueAt)} and is still open.
          </Alert>
        </div>
      )}

      {!activity.isMine && (
        <div className="mb-5">
          <Alert tone="info">
            This belongs to {activity.owner?.fullName ?? "someone else"}, so it does not appear on
            your own activity list.
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>When and where</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Starts">
              {activity.startAt ? formatDateTime(activity.startAt) : "—"}
            </DetailRow>
            <DetailRow label="Due">
              <span className={overdue ? "text-red-600 dark:text-red-400" : undefined}>
                {activity.dueAt ? formatDateTime(activity.dueAt) : "—"}
              </span>
            </DetailRow>
            <DetailRow label="Completed">
              {activity.completedAt ? formatDateTime(activity.completedAt) : "—"}
            </DetailRow>
            <DetailRow label="Location">
              {activity.location ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> {activity.location}
                </span>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Owner">{activity.owner?.fullName ?? "—"}</DetailRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Who it concerns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Contact">
              {activity.contact ? (
                <Link href={`/contacts/${activity.contact?.id}`} className="text-primary hover:underline">
                  {activity.contact?.firstName} {activity.contact?.lastName}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            {activity.contact?.email && (
              <DetailRow label="Email">
                <a
                  href={`mailto:${activity.contact?.email}`}
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                >
                  <Mail className="h-3.5 w-3.5" /> {activity.contact?.email}
                </a>
              </DetailRow>
            )}
            {activity.contact?.phone && (
              <DetailRow label="Phone">
                <a
                  href={`tel:${activity.contact?.phone}`}
                  className="inline-flex items-center gap-1.5 hover:underline"
                >
                  <Phone className="h-3.5 w-3.5" /> {activity.contact?.phone}
                </a>
              </DetailRow>
            )}
            <DetailRow label="Account">
              {activity.contact?.account ? (
                <Link
                  href={`/accounts/${activity.contact?.account?.id}`}
                  className="text-primary hover:underline"
                >
                  {activity.contact?.account?.name}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Related to">
              {activity.relatedEntityType ? (
                relatedHref ? (
                  <Link href={relatedHref} className="text-primary hover:underline">
                    {humanize(activity.relatedEntityType)}
                  </Link>
                ) : (
                  humanize(activity.relatedEntityType)
                )
              ) : (
                "—"
              )}
            </DetailRow>
          </CardContent>
        </Card>
      </div>

      {(activity.description || activity.outcome) && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{activity.outcome ? "Notes and outcome" : "Notes"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {activity.description && (
              <p className="whitespace-pre-line text-muted-foreground">{activity.description}</p>
            )}
            {activity.outcome && (
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Outcome
                </p>
                <p className="mt-1 whitespace-pre-line">{activity.outcome}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
