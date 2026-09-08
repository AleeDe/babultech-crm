import Link from "next/link";
import { notFound } from "next/navigation";
import { listNotes } from "@/server/notes";
import { listDocuments } from "@/server/documents";
import { NotesPanel } from "@/components/notes-panel";
import { DocumentsPanel } from "@/components/documents-panel";
import { getProject, getProjectBurn, getProjectWorkLog } from "@/server/projects";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { getAuditTrail } from "@/lib/audit";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  StatTile, Button, Alert, Forbidden
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, formatNumber, humanize, serialize } from "@/lib/utils";
import { TaskBoard, TeamPanel, PlanPanel, RaidPanel } from "./project-panels";

import { ChangeRequestsPanel } from "./change-requests-panel";
import { RecordTabs } from "@/components/record-tabs";
import { WorkLogPanel } from "./work-log";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.PROJECT_READ)) return <Forbidden what="projects" />;

  const { id } = await params;

  // One wave, not three.
  //
  // These ran as Promise.all -> await getProject -> Promise.all, so the page
  // paid three round trips end to end before rendering. Against the Mumbai
  // database a single query has a median latency of ~400ms, and none of these
  // seven calls needs a result from any other — every one of them takes only
  // `id`, which is known here. Serialising them was costing roughly two thirds
  // of the wait for nothing.
  //
  // The notFound() check still happens before anything reads `project`; it just
  // no longer holds up the other six queries while it waits.
  const [notes, documents, workLog, project, burn, options, audit] =
    await Promise.all([
      listNotes("Project", id),
      listDocuments("Project", id),
      getProjectWorkLog(id),
      getProject(id),
      getProjectBurn(id),
      // Only the user list is read below, but getProjectFormOptions also fetches
      // accounts, opportunities, contracts and currencies for the edit form —
      // four reference tables pulled on every view of a page that never shows
      // them. At ~400ms a query that is most of a second spent on nothing.
      (async () => {
        // Service role, because costRate and defaultBillingRate are revoked
        // from the authenticated role. The page has already checked
        // project:read, and the team panel shows what a person costs before
        // they are booked onto the project.
        const db = supabaseAdmin();
        const { data } = await db
          .from("app_user")
          .select("id, fullName, jobTitle, costRate, defaultBillingRate")
          .eq("status", "ACTIVE")
          .is("deletedAt", null)
          .order("fullName");
        return { users: data ?? [] };
      })(),
      getAuditTrail("Project", id, 10),
    ]);

  if (!project) notFound();

  const approvedHours = Number(project.approvedHours ?? 0);
  const loggedHours = Number(burn.loggedHours);
  const budgetUsed = approvedHours > 0 ? (loggedHours / approvedHours) * 100 : 0;
  const overBudget = approvedHours > 0 && loggedHours > approvedHours;

  const openTasks = project.tasks.filter((t: Record<string, any>) => !["COMPLETED", "CANCELLED"].includes(t.status));
  const overdueTasks = openTasks.filter((t: Record<string, any>) => t.dueDate && t.dueDate < new Date());
  const openRisks = project.risks.filter((r: Record<string, any>) => r.status === "OPEN");
  const openIssues = project.issues.filter((i: Record<string, any>) => i.status === "OPEN");
  const margin = Number(burn.billableValue) - Number(burn.cost);

  const s = serialize({
    tasks: project.tasks,
    phases: project.phases,
    milestones: project.milestones,
    members: project.members,
    risks: project.risks,
    issues: project.issues,
    users: options.users,
  });

  return (
    <>
      <PageHeader
        backTo="/projects"
        backLabel="Back to projects"
        title={project.name}
        description={`${project.projectNumber} · ${project.account?.name ?? "Internal project"}`}
      >
        <Badge tone={statusTone(project.health)}>{humanize(project.health)}</Badge>
        <Badge tone={statusTone(project.status)}>{humanize(project.status)}</Badge>
        <Button asChild variant="outline">
          <Link href={`/projects/${project.id}/edit`}>Edit</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Progress"
          value={formatPercent(project.completionPercent, 0)}
          sublabel={`${project.tasks.length - openTasks.length} of ${project.tasks.length} tasks done`}
          tone="info"
        />
        <StatTile
          label="Hours logged"
          value={formatNumber(burn.loggedHours, 1)}
          sublabel={approvedHours > 0 ? `${formatPercent(budgetUsed, 0)} of ${formatNumber(approvedHours, 0)}h approved` : "No budget set"}
          tone={overBudget ? "danger" : budgetUsed > 80 ? "warning" : "neutral"}
        />
        <StatTile
          label="Billable value"
          value={formatMoney(burn.billableValue, project.currencyCode)}
          sublabel={`Cost ${formatMoney(burn.cost, project.currencyCode)}`}
        />
        <StatTile
          label="Margin to date"
          value={formatMoney(margin, project.currencyCode)}
          sublabel="Approved time only"
          tone={margin >= 0 ? "success" : "danger"}
        />
      </div>

      {(overBudget || overdueTasks.length > 0) && (
        <div className="mt-5 space-y-3">
          {overBudget && (
            <Alert tone="danger">
              {formatNumber(loggedHours - approvedHours, 1)} hours over the approved budget. Raise a
              change request before logging more time against this engagement.
            </Alert>
          )}
          {overdueTasks.length > 0 && (
            <Alert tone="warning">
              {overdueTasks.length} task(s) are past their due date.
            </Alert>
          )}
        </div>
      )}

      {/* Everything below the headline moved into tabs.

          The page rendered nine panels in one column - a drag board, a second
          task list showing the same tasks, a plan, a team, a RAID log, change
          requests, details, notes and documents. Reaching the team meant
          scrolling past every task card on the project, and nothing on screen
          said which parts mattered.

          What stays above the tabs is what answers "is this project in
          trouble?" - the status, the four figures, and the two alerts. Those
          are read at a glance and acted on; the rest is read on purpose. */}
      <RecordTabs
        tabs={[
          {
            value: "tasks",
            label: "Tasks",
            count: s.tasks.length,
            content: (
              // One board, one source of truth.
              //
              // Two boards of the same tasks were stacked here: TaskBoardView
              // for dragging, TaskBoard for adding and editing. No tool that
              // does this well - ClickUp, Linear, Jira - shows the same tasks
              // twice; a view switcher changes how you see them, never how many
              // copies there are. TaskBoard now drags too, so the second board
              // has nothing left to offer.
              <TaskBoard
                projectId={project.id}
                tasks={s.tasks as never}
                phases={s.phases as never}
                milestones={s.milestones as never}
                members={s.members as never}
              />
            ),
          },
          {
            value: "activity",
            label: "Work log",
            count: workLog.entries.length,
            content: (
              <WorkLogPanel
                projectId={project.id}
                log={workLog}
                tasks={(s.tasks as never as { id: string; name: string }[]).map((t) => ({ id: t.id, name: t.name }))}
                approvedHours={project.approvedHours ? Number(project.approvedHours) : null}
                canLog={can(_me, PERMISSIONS.PROJECT_READ)}
              />
            ),
          },
          {
            value: "plan",
            label: "Plan",
            count: s.phases.length + s.milestones.length,
            content: (
              <PlanPanel
                projectId={project.id}
                phases={s.phases as never}
                milestones={s.milestones as never}
                users={s.users as never}
                currency={project.currencyCode}
                contractValue={project.contractValue ? String(project.contractValue) : null}
              />
            ),
          },
          {
            value: "team",
            label: "Team",
            count: s.members.length,
            content: (
              <TeamPanel
                projectId={project.id}
                members={s.members as never}
                users={s.users as never}
                currency={project.currencyCode}
              />
            ),
          },
          {
            value: "raid",
            label: "Risks & issues",
            count: openRisks.length + openIssues.length,
            content: (
              <div className="space-y-6">
                <RaidPanel
                  projectId={project.id}
                  risks={s.risks as never}
                  issues={s.issues as never}
                  users={s.users as never}
                />
                <ChangeRequestsPanel changeRequests={project.changeRequests} />
              </div>
            ),
          },
          {
            value: "details",
            label: "Details",
            content: (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <Row label="Customer">
                      {project.account ? (
                        <>
                          <Link href={`/accounts/${project.account?.id}`} className="text-primary hover:underline">
                            {project.account?.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">{project.account?.accountNumber}</p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Internal - our own work, no customer</span>
                      )}
                    </Row>
                    <Row label="Project manager">{project.projectManager?.fullName}</Row>
                    <Row label="Sourced from">
                      {project.opportunity ? (
                        <Link href={`/opportunities/${project.opportunity?.id}`} className="text-primary hover:underline">
                          {project.opportunity?.opportunityNumber} - {project.opportunity?.name}
                        </Link>
                      ) : "—"}
                    </Row>
                    <Row label="Contract">
                      {project.contract ? (
                        <Link href="/contracts" className="text-primary hover:underline">
                          {project.contract.contractNumber}
                        </Link>
                      ) : "—"}
                    </Row>
                    {/* Billing type is a customer-payment term; internal work
                        carries a placeholder value that would only mislead. */}
                    {project.projectType !== "INTERNAL" && (
                      <Row label="Billing">{humanize(project.billingType)}</Row>
                    )}
                    <Row label={project.projectType === "INTERNAL" ? "Budget" : "Contract value"}>
                      {formatMoney(project.contractValue, project.currencyCode)}
                    </Row>
                    <Row label="Schedule">
                      {formatDate(project.startDate)} → {formatDate(project.plannedEndDate)}
                      {project.actualEndDate && (
                        <p className="text-xs text-muted-foreground">
                          Actually ended {formatDate(project.actualEndDate)}
                        </p>
                      )}
                    </Row>
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  {project.scope && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Scope</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="whitespace-pre-wrap text-sm">{project.scope}</p>
                      </CardContent>
                    </Card>
                  )}

                  {project.cases.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Linked support cases</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        {project.cases.map((c: Record<string, any>) => (
                          <div key={c.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0">
                            <Link href={`/cases/${c.id}`} className="min-w-0 flex-1 truncate hover:underline">
                              {c.subject}
                              <span className="block text-xs text-muted-foreground">{c.caseNumber}</span>
                            </Link>
                            <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardHeader>
                      <CardTitle>Change history</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {audit.length === 0 ? (
                        <p className="text-muted-foreground">No changes recorded.</p>
                      ) : (
                        audit.map((a: Record<string, any>) => (
                          <div key={a.id}>
                            <p>
                              <span className="font-medium">{humanize(a.fieldName)}</span>{" "}
                              <span className="text-muted-foreground">
                                {a.oldValue ?? "empty"} → {a.newValue ?? "empty"}
                              </span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {a.changedBy?.fullName ?? "System"} · {formatDate(a.changedAt)}
                            </p>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            ),
          },
          {
            value: "files",
            label: "Notes & files",
            count: notes.length + documents.length,
            content: (
              <div className="grid gap-6 lg:grid-cols-2">
                <NotesPanel entityType="Project" entityId={id} notes={notes} />
                <DocumentsPanel entityType="Project" entityId={id} documents={documents} />
              </div>
            ),
          },
        ]}
      />

    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
