import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Alert,
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, humanize } from "@/lib/utils";

/**
 * Read-only project view. The full delivery module (phases, milestones, tasks,
 * timesheets, risks, change control) is Phase 3 — the schema is already in
 * place, so this page reads real data as soon as projects exist.
 */
export default async function ProjectsPage() {
  await requireUser();

  const projects = await prisma.project.findMany({
    where: { deletedAt: null },
    include: {
      account: { select: { id: true, name: true } },
      projectManager: { select: { fullName: true } },
      _count: { select: { members: true, tasks: true, milestones: true, issues: true } },
    },
    orderBy: { startDate: "desc" },
  });

  const active = projects.filter((p) => p.status === "ACTIVE");
  const atRisk = projects.filter((p) => p.health === "RED" || p.status === "AT_RISK");

  return (
    <>
      <PageHeader
        title="Projects"
        description="Delivery engagements created from a won deal or a signed contract."
      />

      <div className="mb-6">
        <Alert tone="info">
          Phase 3 module. The data model for phases, milestones, tasks, timesheets, risks, issues
          and change requests is already built — this page lists projects; the delivery workspace
          comes next.
        </Alert>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active projects" value={String(active.length)} />
        <StatTile label="At risk" value={String(atRisk.length)} tone={atRisk.length ? "danger" : "success"} />
        <StatTile
          label="Contracted value"
          value={formatMoney(active.reduce((s, p) => s + Number(p.contractValue ?? 0), 0))}
        />
        <StatTile label="Total projects" value={String(projects.length)} />
      </div>

      <Card className="mt-6">
        {projects.length === 0 ? (
          <EmptyState title="No projects yet" description="Projects are created from a won opportunity or an active contract." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Project</TH>
                <TH>Customer</TH>
                <TH>Manager</TH>
                <TH>Schedule</TH>
                <TH className="text-right">Value</TH>
                <TH className="text-right">Progress</TH>
                <TH>Health</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {projects.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <span className="font-medium">{p.name}</span>
                    <p className="text-xs text-muted-foreground">
                      {p.projectNumber} · {p._count.tasks} tasks · {p._count.milestones} milestones
                    </p>
                  </TD>
                  <TD className="text-sm">{p.account.name}</TD>
                  <TD className="text-sm text-muted-foreground">{p.projectManager.fullName}</TD>
                  <TD className="text-sm">
                    {formatDate(p.startDate)} → {formatDate(p.plannedEndDate)}
                  </TD>
                  <TD className="text-right tabular">{formatMoney(p.contractValue, p.currencyCode)}</TD>
                  <TD className="text-right tabular">{formatPercent(p.completionPercent, 0)}</TD>
                  <TD>
                    <Badge tone={statusTone(p.health)}>{humanize(p.health)}</Badge>
                  </TD>
                  <TD>
                    <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
