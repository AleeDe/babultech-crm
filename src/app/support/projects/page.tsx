import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { listCustomerProjects } from "@/server/customer-projects";
import { PageHeader, Card, CardContent, Badge, statusTone } from "@/components/ui";
import { formatDate, humanize } from "@/lib/utils";

export default async function CustomerProjectsPage() {
  const projects = await listCustomerProjects();
  return (
    <>
      <PageHeader title="Projects" description="The work we are doing for your company, how far along it is, and anything waiting for your approval." />
      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FolderKanban className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No projects with us yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} href={`/support/projects/${p.id}`} className="rounded-lg border bg-card p-4 transition-colors hover:border-primary/40">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.projectNumber}</p>
                </div>
                <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
              </div>
              <div className="mt-3 h-2 rounded bg-muted">
                <div className="h-2 rounded bg-primary" style={{ width: `${Math.min(100, p.completionPercent)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {Math.round(p.completionPercent)}% done{p.plannedEndDate ? ` · due ${formatDate(p.plannedEndDate)}` : ""}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
