import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, EmptyState, StatTile,
} from "@/components/ui";
import { formatDateTime, humanize } from "@/lib/utils";

export default async function ActivitiesPage() {
  const user = await requireUser();

  const activities = await prisma.activity.findMany({
    where: { deletedAt: null, ownerUserId: user.id },
    include: { contact: { select: { firstName: true, lastName: true } } },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: 200,
  });

  const now = new Date();
  const open = activities.filter((a) => a.status === "OPEN");
  const overdue = open.filter((a) => a.dueAt && a.dueAt < now);
  const today = open.filter(
    (a) => a.dueAt && a.dueAt.toDateString() === now.toDateString(),
  );

  return (
    <>
      <PageHeader
        title="My activities"
        description="Calls, meetings, tasks and reminders assigned to you across every module."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open" value={String(open.length)} />
        <StatTile label="Overdue" value={String(overdue.length)} tone={overdue.length ? "danger" : "success"} />
        <StatTile label="Due today" value={String(today.length)} tone="info" />
        <StatTile label="Completed" value={String(activities.filter((a) => a.status === "COMPLETED").length)} tone="success" />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>All activities</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {activities.length === 0 ? (
            <div className="px-5">
              <EmptyState title="Nothing scheduled" description="Activities can be logged against any lead, deal, case or project." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Subject</TH>
                  <TH>Type</TH>
                  <TH>Contact</TH>
                  <TH>Related to</TH>
                  <TH>Due</TH>
                  <TH>Priority</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {activities.map((a) => {
                  const late = a.status === "OPEN" && a.dueAt && a.dueAt < now;
                  return (
                    <TR key={a.id}>
                      <TD className="text-sm font-medium">{a.subject}</TD>
                      <TD>
                        <Badge tone="neutral">{humanize(a.activityType)}</Badge>
                      </TD>
                      <TD className="text-sm text-muted-foreground">
                        {a.contact ? `${a.contact.firstName} ${a.contact.lastName}` : "—"}
                      </TD>
                      <TD className="text-sm text-muted-foreground">
                        {a.relatedEntityType ? humanize(a.relatedEntityType) : "—"}
                      </TD>
                      <TD className={`text-sm ${late ? "text-red-600 dark:text-red-400" : ""}`}>
                        {formatDateTime(a.dueAt)}
                      </TD>
                      <TD>
                        <Badge tone={statusTone(a.priority)}>{humanize(a.priority)}</Badge>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(a.status)}>{humanize(a.status)}</Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
