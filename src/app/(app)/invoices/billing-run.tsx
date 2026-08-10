"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { runMilestoneBilling, runTimeBilling } from "@/server/billing";
import { Button, Card, CardContent, CardHeader, CardTitle, Select, Alert } from "@/components/ui";

/**
 * Billing runs. Both produce **draft** invoices — nothing goes to a customer
 * without someone issuing it, which is the point of a run being separate from
 * a send.
 */
export function BillingRun({
  projects,
}: {
  projects: { id: string; name: string; projectNumber: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");

  function milestones() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await runMilestoneBilling(projectId || undefined);
      if (result.ok) {
        const { created, skipped } = result.data;
        setNotice(
          created === 0
            ? "No completed billing milestones are waiting to be invoiced."
            : `${created} draft invoice(s) raised.${skipped.length ? ` Skipped: ${skipped.join("; ")}` : ""}`,
        );
        router.refresh();
      } else setError(result.error);
    });
  }

  function time() {
    setError(null);
    setNotice(null);
    if (!projectId) {
      setError("Choose a project — time billing runs one engagement at a time.");
      return;
    }
    startTransition(async () => {
      const result = await runTimeBilling(projectId);
      if (result.ok && result.data) {
        setNotice(`Draft invoice raised for ${result.data.hours} approved hours.`);
        router.push(`/invoices/${result.data.id}`);
      } else if (!result.ok) setError(result.error);
    });
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Play className="h-4 w-4" /> Billing run
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Billing run</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        <p className="text-sm text-muted-foreground">
          Both runs produce drafts. Nothing reaches a customer until it is issued.
        </p>

        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects (milestone run only)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.projectNumber} — {p.name}</option>
          ))}
        </Select>

        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={milestones}>
            {pending ? "Running…" : "Bill completed milestones"}
          </Button>
          <Button variant="outline" disabled={pending} onClick={time}>
            Bill approved time
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Milestone billing picks up completed, billing-flagged milestones that have not been
          invoiced. Time billing picks up approved, billable hours that carry a rate and have not
          been billed, grouped by person.
        </p>
      </CardContent>
    </Card>
  );
}
