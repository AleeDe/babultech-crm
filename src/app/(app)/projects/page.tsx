import Link from "next/link";
import { Plus } from "lucide-react";
import { listProjects } from "@/server/projects";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Input, Select, Button,
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, humanize } from "@/lib/utils";

const STATUSES = ["DRAFT", "PLANNING", "ACTIVE", "ON_HOLD", "AT_RISK", "COMPLETED", "CANCELLED"];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  const params = await searchParams;
  const projects = await listProjects(params);

  const active = projects.filter((p) => p.status === "ACTIVE");
  const atRisk = projects.filter((p) => p.health === "RED" || p.status === "AT_RISK");
  const overdue = projects.filter(
    (p) =>
      p.plannedEndDate &&
      p.plannedEndDate < new Date() &&
      !["COMPLETED", "CANCELLED"].includes(p.status),
  );

  return (
    <>
      <PageHeader
        title="Projects"
        description="Delivery engagements. Open one to run its plan, tasks, team and RAID log."
      >
        <Button asChild>
          <Link href="/projects/new">
            <Plus className="h-4 w-4" /> New project
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active projects" value={String(active.length)} />
        <StatTile label="At risk" value={String(atRisk.length)} tone={atRisk.length ? "danger" : "success"} />
        <StatTile label="Past planned end" value={String(overdue.length)} tone={overdue.length ? "warning" : "neutral"} />
        <StatTile
          label="Contracted value"
          value={formatMoney(active.reduce((s, p) => s + Number(p.contractValue ?? 0), 0))}
        />
      </div>

      <Card className="mt-6">
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <div className="min-w-[220px] flex-1">
            <Input name="search" placeholder="Search project, number or customer…" defaultValue={params.search} />
          </div>
          <Select name="status" defaultValue={params.status ?? ""} className="w-48">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        {projects.length === 0 ? (
          <EmptyState
            title="No projects match"
            description="Projects are usually created from a won opportunity or a signed contract."
            action={
              <Button asChild>
                <Link href="/projects/new">Create a project</Link>
              </Button>
            }
          />
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
              {projects.map((p) => {
                const late =
                  p.plannedEndDate &&
                  p.plannedEndDate < new Date() &&
                  !["COMPLETED", "CANCELLED"].includes(p.status);

                return (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {p.projectNumber} · {p._count.tasks} tasks · {p._count.members} people
                        {p._count.issues > 0 && ` · ${p._count.issues} issue(s)`}
                      </p>
                    </TD>
                    <TD className="text-sm">
                      <Link href={`/accounts/${p.account.id}`} className="hover:underline">
                        {p.account.name}
                      </Link>
                    </TD>
                    <TD className="text-sm text-muted-foreground">{p.projectManager.fullName}</TD>
                    <TD className={`whitespace-nowrap text-sm ${late ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatDate(p.startDate)} → {formatDate(p.plannedEndDate)}
                    </TD>
                    <TD className="text-right tabular">{formatMoney(p.contractValue, p.currencyCode)}</TD>
                    <TD className="text-right">
                      <div className="ml-auto w-20">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-primary" style={{ width: `${Number(p.completionPercent)}%` }} />
                        </div>
                        <p className="mt-1 text-xs tabular text-muted-foreground">
                          {formatPercent(p.completionPercent, 0)}
                        </p>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(p.health)}>{humanize(p.health)}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
