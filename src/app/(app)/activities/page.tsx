import Link from "next/link";
import { Plus } from "lucide-react";
import { supabaseServer } from "@/lib/supabase";
import { one } from "@/lib/decimal";
import { requireUser } from "@/lib/authz";
import {
  PageHeader, Button, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, EmptyState, StatTile,
} from "@/components/ui";
import { formatDateTime, humanize, entityHref } from "@/lib/utils";

export default async function ActivitiesPage() {
  const user = await requireUser();

  const db = await supabaseServer();

  const { data: activityRows } = await db
    .from("activity")
    .select("*, contact ( id, firstName, lastName )")
    .is("deletedAt", null)
    .eq("ownerUserId", user.id)
    .order("status")
    .order("dueAt")
    .limit(200);

  const activities = (activityRows ?? []).map((a) => ({
    ...a,
    contact: one(a.contact as never),
  }));

  const now = new Date();

  // dueAt arrives as an ISO string, not a Date. Comparing a string to a Date is
  // always false and `.toDateString()` does not exist on it, so both are parsed
  // first — otherwise the overdue and due-today counts silently read zero.
  const dueAtOf = (a: { dueAt?: unknown }) =>
    a.dueAt ? new Date(a.dueAt as string) : null;

  const open = activities.filter((a) => a.status === "OPEN");
  const overdue = open.filter((a) => {
    const due = dueAtOf(a);
    return due !== null && due < now;
  });
  const today = open.filter((a) => {
    const due = dueAtOf(a);
    return due !== null && due.toDateString() === now.toDateString();
  });

  return (
    <>
      <PageHeader
        title="My activities"
        description="Calls, meetings, tasks and reminders assigned to you across every module."
      >
        <Button asChild>
          <Link href="/activities/new">
            <Plus className="h-4 w-4" /> New activity
          </Link>
        </Button>
      </PageHeader>

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
                      <TD className="text-sm">
                        {a.contact ? (
                          <Link href={`/contacts/${a.contact?.id}/edit`} className="hover:underline">
                            {a.contact?.firstName} {a.contact?.lastName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TD>
                      <TD className="text-sm">
                        {(() => {
                          const href = entityHref(a.relatedEntityType, a.relatedEntityId);
                          if (!a.relatedEntityType) return <span className="text-muted-foreground">—</span>;
                          const label = humanize(a.relatedEntityType);
                          return href ? (
                            <Link href={href} className="text-primary hover:underline">{label}</Link>
                          ) : (
                            <span className="text-muted-foreground">{label}</span>
                          );
                        })()}
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
