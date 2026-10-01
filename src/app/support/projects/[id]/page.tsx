import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authz";
import { getCustomerProject } from "@/server/customer-projects";
import { PageHeader, Card, CardContent, CardHeader, CardTitle, Badge, statusTone } from "@/components/ui";
import { formatDate, humanize } from "@/lib/utils";
import { DeliverableDecision } from "./deliverable-decision";

const DELIVERABLE: Record<string, { label: string; tone: "info" | "success" | "warning" }> = {
  SUBMITTED: { label: "Waiting for your approval", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
  CHANGES_REQUESTED: { label: "Changes asked for", tone: "warning" },
};

export default async function CustomerProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const project = await getCustomerProject(id);
  if (!project) notFound();
  const isAdmin = me.portalRole === "ADMIN";

  return (
    <>
      <PageHeader
        backTo="/support/projects"
        backLabel="Back to projects"
        title={project.name}
        description={`${project.projectNumber} · ${Math.round(project.completionPercent)}% done${project.plannedEndDate ? ` · due ${formatDate(project.plannedEndDate)}` : ""}`}
      >
        <Badge tone={statusTone(project.status)}>{humanize(project.status)}</Badge>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>For your approval</CardTitle>
          {!isAdmin && (
            <p className="mt-1 text-sm text-muted-foreground">Your company&apos;s portal Admin approves deliverables or asks for changes.</p>
          )}
        </CardHeader>
        <CardContent>
          {project.deliverables.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has been handed over yet.</p>
          ) : (
            <ul className="space-y-3">
              {project.deliverables.map((d) => (
                <li key={d.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{d.name}</p>
                      {d.milestoneName && <p className="text-xs text-muted-foreground">Milestone: {d.milestoneName}</p>}
                    </div>
                    <Badge tone={DELIVERABLE[d.status]?.tone ?? "info"}>{DELIVERABLE[d.status]?.label ?? d.status}</Badge>
                  </div>
                  {d.description && <p className="mt-2 whitespace-pre-line text-muted-foreground">{d.description}</p>}
                  {d.link && (
                    <a href={d.link} target="_blank" rel="noreferrer" className="mt-1 inline-block text-primary hover:underline">Open it</a>
                  )}
                  {d.customerComment && <p className="mt-2 text-xs text-muted-foreground">Your comment: {d.customerComment}</p>}
                  {d.status === "SUBMITTED" && isAdmin && <DeliverableDecision id={d.id} name={d.name} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Phases</CardTitle></CardHeader>
          <CardContent>
            {project.phases.length === 0 ? (
              <p className="text-sm text-muted-foreground">No phases set out yet.</p>
            ) : (
              <ol className="space-y-3">
                {project.phases.map((p) => (
                  <li key={p.id} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{humanize(p.status)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded bg-muted">
                      <div className="h-1.5 rounded bg-primary" style={{ width: `${Math.min(100, p.completionPercent)}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Milestones</CardTitle></CardHeader>
          <CardContent>
            {project.milestones.length === 0 ? (
              <p className="text-sm text-muted-foreground">No milestones set yet.</p>
            ) : (
              <ul className="space-y-2">
                {project.milestones.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {m.name}
                      <span className="block text-xs text-muted-foreground">
                        {m.completedDate ? `Done ${formatDate(m.completedDate)}` : m.dueDate ? `Due ${formatDate(m.dueDate)}` : "No date yet"}
                      </span>
                    </span>
                    <Badge tone={statusTone(m.status)}>{humanize(m.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
