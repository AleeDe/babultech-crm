import Link from "next/link";
import { requireUser, can } from "@/lib/authz";
import { REPORTS } from "@/lib/reports";
import { listMySchedules } from "@/server/reports";
import { PageHeader, Card, CardHeader, CardTitle, CardContent, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { RemoveSchedule } from "./[key]/report-tools";

export default async function ReportsPage() {
  const me = await requireUser();
  const mine = REPORTS.filter((r) => can(me, r.permission));
  const schedules = await listMySchedules();
  return (
    <>
      <PageHeader
        title="Reports"
        description="Ready-made reports with filters and a CSV download. Any of them can come to you weekly or monthly."
      />
      {mine.length === 0 ? (
        <EmptyState title="No reports for your role" description="Reports follow what your role may see." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((r) => (
            <Link key={r.key} href={`/reports/${r.key}`} className="rounded-lg border bg-card p-4 transition-colors hover:border-primary/40">
              <p className="font-medium">{r.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
            </Link>
          ))}
        </div>
      )}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Your scheduled reports</CardTitle>
        </CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">None. Open a report and choose Send me this weekly or monthly.</p>
          ) : (
            <ul className="space-y-2">
              {schedules.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <Link href={s.link} className="font-medium hover:underline">{s.title}</Link>
                    <span className="text-muted-foreground"> · {s.frequency.toLowerCase()}, next on {formatDate(s.nextRunAt)}</span>
                  </span>
                  <RemoveSchedule id={s.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
