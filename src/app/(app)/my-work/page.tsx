import Link from "next/link";
import { CheckSquare, FolderKanban, LifeBuoy, CalendarCheck, Clock } from "lucide-react";
import { getMyWork } from "@/server/my-work";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, StatTile, EmptyState, Button, Alert,
} from "@/components/ui";
import { formatDate, formatDateTime, formatPercent, humanize } from "@/lib/utils";
import { TaskProgress } from "./task-progress";

/**
 * One screen for "what am I supposed to be doing".
 *
 * The project screens are organised by project, which is right for whoever is
 * running them and wrong for someone booked across three. This is the same
 * data indexed by assignee.
 */
export default async function MyWorkPage() {
  const { me, tasks, projects, cases, activities, summary } = await getMyWork();

  const nothingAssigned =
    tasks.length === 0 && projects.length === 0 && cases.length === 0 && activities.length === 0;

  return (
    <>
      <PageHeader
        title="My work"
        description="Tasks, projects, cases and activities assigned to you."
      >
        <Button asChild variant="outline">
          <Link href="/timesheets">Log time</Link>
        </Button>
      </PageHeader>

      {nothingAssigned ? (
        <EmptyState
          title="Nothing assigned to you yet"
          description="When someone books you onto a project or assigns you a task, it appears here."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Open tasks"
              value={String(summary.openTasks)}
              sublabel={summary.blockedTasks > 0 ? `${summary.blockedTasks} blocked` : undefined}
              tone={summary.blockedTasks > 0 ? "warning" : "neutral"}
            />
            <StatTile
              label="Overdue"
              value={String(summary.overdueTasks)}
              tone={summary.overdueTasks > 0 ? "danger" : "success"}
              sublabel="Past their due date"
            />
            <StatTile
              label="Hours this week"
              value={summary.hoursThisWeek}
              href="/timesheets"
              sublabel={
                Number(summary.hoursUnsubmitted) > 0
                  ? `${summary.hoursUnsubmitted}h not yet approved`
                  : "All submitted"
              }
              tone={Number(summary.hoursThisWeek) === 0 ? "warning" : "neutral"}
            />
            <StatTile
              label="On projects"
              value={String(projects.length)}
              sublabel={`${summary.activeProjects} active`}
              tone="info"
            />
          </div>

          {Number(summary.hoursThisWeek) === 0 && (
            <div className="mt-5">
              <Alert tone="warning">
                No time logged this week. Unlogged hours cost the project nothing and make
                utilisation read low, <Link href="/timesheets" className="underline">log them here</Link>.
              </Alert>
            </div>
          )}

          <Card className="mt-6">
            <CardHeader className="flex flex-row items-center gap-2">
              <CheckSquare className="h-4 w-4 text-muted-foreground" />
              <CardTitle>My tasks</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {tasks.length === 0 ? (
                <p className="px-5 pb-2 text-sm text-muted-foreground">No open tasks.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Task</TH>
                      <TH priority="secondary">Project</TH>
                      <TH priority="secondary">Due</TH>
                      <TH className="text-right" priority="tertiary">Progress</TH>
                      <TH>Status</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {tasks.map((t: Record<string, any>) => (
                      <TR key={t.id} className={t.status === "BLOCKED" ? "bg-amber-50/50 dark:bg-amber-950/20" : undefined}>
                        <TD>
                          <span className="font-medium">{t.name}</span>
                          {t.phase && (
                            <p className="text-xs text-muted-foreground">{t.phase?.name}</p>
                          )}
                        </TD>
                        <TD priority="secondary" className="text-sm">
                          <Link href={`/projects/${t.project?.id}`} className="hover:underline">
                            {t.project?.name}
                          </Link>
                        </TD>
                        <TD priority="secondary" className={`text-sm ${t.overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                          {t.dueDate ? formatDate(t.dueDate) : "—"}
                        </TD>
                        <TD priority="tertiary" className="text-right tabular text-sm">
                          {formatPercent(Number(t.completionPercent ?? 0), 0)}
                        </TD>
                        <TD>
                          <Badge tone={statusTone(t.status)}>{humanize(t.status)}</Badge>
                        </TD>
                        <TD className="text-right">
                          <TaskProgress
                            taskId={t.id}
                            status={t.status}
                            completionPercent={Number(t.completionPercent ?? 0)}
                          />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <FolderKanban className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Projects I am on</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Not booked onto any project.</p>
                ) : (
                  projects.map((p: Record<string, any>) => (
                    <div key={p.id} className="flex items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
                      <div className="min-w-0">
                        <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {p.account?.name} · {p.membership?.projectRole ?? "Member"}
                          {p.membership?.allocationPercent
                            ? ` · ${Number(p.membership.allocationPercent)}% allocated`
                            : ""}
                        </p>
                        {p.openTasks > 0 && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {p.openTasks} open task{p.openTasks === 1 ? "" : "s"} for you
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
                        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                          {formatPercent(Number(p.completionPercent ?? 0), 0)} done
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <LifeBuoy className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Cases assigned to me</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {cases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open cases.</p>
                ) : (
                  cases.map((c: Record<string, any>) => (
                    <div key={c.id} className="flex items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
                      <div className="min-w-0">
                        <Link href={`/cases/${c.id}`} className="font-medium hover:underline">
                          {c.subject}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {c.caseNumber} · {c.account?.name}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge tone={statusTone(c.priority)}>{humanize(c.priority)}</Badge>
                        {c.slaBreached && (
                          <p className="mt-1 text-xs text-red-600 dark:text-red-400">SLA breached</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader className="flex flex-row items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-muted-foreground" />
              <CardTitle>My activities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                activities.map((a: Record<string, any>) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <Link href={`/activities/${a.id}`} className="text-sm font-medium hover:underline">
                        {a.subject}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {humanize(a.activityType)}
                        {a.contact && ` · ${a.contact?.firstName} ${a.contact?.lastName}`}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-xs ${a.overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
                    >
                      {a.dueAt ? formatDateTime(a.dueAt) : "No due date"}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
