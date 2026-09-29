import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { listJobs, getRunnerStatus } from "@/server/jobs";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Table, THead, TBody, TR, TH, TD, Badge, EmptyState,
} from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { AutoRefresh } from "@/components/auto-refresh";
import { SchedulerCard } from "./scheduler-card";
import { CancelJobButton } from "./cancel-job-button";

const TONE: Record<string, "neutral" | "info" | "success" | "danger" | "warning"> = {
  QUEUED: "neutral",
  RUNNING: "info",
  DONE: "success",
  FAILED: "danger",
  CANCELLED: "warning",
};

export default async function JobsPage() {
  const me = await requireUser();
  const isAdmin = can(me, PERMISSIONS.ADMIN);
  const [jobs, runner] = await Promise.all([listJobs(), getRunnerStatus()]);
  const busy = jobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING");

  return (
    <>
      {busy && <AutoRefresh />}
      <PageHeader
        title="Background jobs"
        description={
          isAdmin
            ? "Work that runs without anyone waiting for it: mass emails and imports. Everyone's, newest first."
            : "Work you started that runs in the background, such as a mass email. Newest first."
        }
      />

      {runner && <SchedulerCard status={runner} />}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
        </CardHeader>
        {jobs.length === 0 ? (
          <CardContent>
            <EmptyState title="No jobs yet" description="A mass email shows here while it goes out." />
          </CardContent>
        ) : (
          <CardContent className="px-0">
            <Table>
              <THead>
                <TR>
                  <TH>Job</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Progress</TH>
                  <TH priority="secondary">Started</TH>
                  {isAdmin && <TH priority="secondary">By</TH>}
                  <TH />
                </TR>
              </THead>
              <TBody>
                {jobs.map((j) => (
                  <TR key={j.id}>
                    <TD className="text-sm font-medium">
                      {j.link ? <Link href={j.link} className="hover:underline">{j.title}</Link> : j.title}
                      {j.errors.length > 0 && (
                        <p className="mt-0.5 text-xs font-normal text-destructive">{j.errors[j.errors.length - 1]}</p>
                      )}
                    </TD>
                    <TD><Badge tone={TONE[j.status] ?? "neutral"}>{j.status.charAt(0) + j.status.slice(1).toLowerCase()}</Badge></TD>
                    <TD className="text-right text-sm tabular-nums">
                      {j.progressDone}{j.progressTotal != null ? ` of ${j.progressTotal}` : ""}
                    </TD>
                    <TD className="text-sm" priority="secondary">{formatDateTime(j.createdAt)}</TD>
                    {isAdmin && <TD className="text-sm" priority="secondary">{j.createdByName ?? "—"}</TD>}
                    <TD className="text-right">
                      {(j.status === "QUEUED" || j.status === "RUNNING") && <CancelJobButton id={j.id} />}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </>
  );
}
