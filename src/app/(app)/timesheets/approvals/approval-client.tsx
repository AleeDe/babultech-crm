"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { approveTimeLogs, rejectTimeLogs } from "@/server/timesheets";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Input, Alert,
  Table, THead, TBody, TR, TH, TD, EmptyState,
} from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/utils";

export interface PendingEntry {
  id: string;
  workDate: string;
  hours: string;
  description: string;
  billable: boolean;
  user: { id: string; fullName: string };
  project: { id: string; name: string; projectNumber: string } | null;
  projectTask: { id: string; name: string } | null;
  case: { id: string; caseNumber: string } | null;
}

export function ApprovalClient({ entries }: { entries: PendingEntry[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState(false);

  const ids = [...selected];
  const selectedHours = entries
    .filter((e) => selected.has(e.id))
    .reduce((s, e) => s + Number(e.hours), 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function approve() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await approveTimeLogs(ids);
      if (result.ok) {
        setNotice(`${result.data.count} entr${result.data.count === 1 ? "y" : "ies"} approved.`);
        setSelected(new Set());
        router.refresh();
      } else setError(result.error);
    });
  }

  function reject(formData: FormData) {
    setError(null);
    setNotice(null);
    const reason = String(formData.get("reason") ?? "");
    startTransition(async () => {
      const result = await rejectTimeLogs(ids, reason);
      if (result.ok) {
        setNotice(`${result.data.count} entr${result.data.count === 1 ? "y" : "ies"} returned to their author.`);
        setSelected(new Set());
        setRejecting(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        title="Nothing waiting for approval"
        description="Submitted timesheets appear here. You cannot approve your own time."
      />
    );
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>
            {entries.length} entr{entries.length === 1 ? "y" : "ies"} submitted
            {selected.size > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {selected.size} selected · {formatNumber(selectedHours, 2)}h
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelected(selected.size === entries.length ? new Set() : new Set(entries.map((e) => e.id)))}
            >
              {selected.size === entries.length ? "Clear" : "Select all"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={pending || ids.length === 0} onClick={() => setRejecting(!rejecting)}>
              Reject
            </Button>
            <Button type="button" size="sm" disabled={pending || ids.length === 0} onClick={approve}>
              Approve {ids.length > 0 && `(${ids.length})`}
            </Button>
          </div>
        </CardHeader>

        {rejecting && (
          <CardContent className="pb-4">
            <form action={reject} className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
              <div className="min-w-[260px] flex-1">
                <Input name="reason" required placeholder="Why is this being returned? The author will see it." />
              </div>
              <Button type="submit" variant="destructive" size="sm" disabled={pending}>
                Return {ids.length} entr{ids.length === 1 ? "y" : "ies"}
              </Button>
            </form>
          </CardContent>
        )}

        <CardContent className="px-0">
          <Table>
            <THead>
              <TR>
                <TH className="w-10" />
                <TH>Person</TH>
                <TH>Booked to</TH>
                <TH>Date</TH>
                <TH className="text-right">Hours</TH>
                <TH>Description</TH>
              </TR>
            </THead>
            <TBody>
              {entries.map((e) => (
                <TR key={e.id}>
                  <TD>
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                      className="h-4 w-4 rounded border-input"
                      aria-label={`Select ${e.user.fullName} ${e.workDate}`}
                    />
                  </TD>
                  <TD className="text-sm font-medium">{e.user.fullName}</TD>
                  <TD className="text-sm">
                    {e.project ? (
                      <Link href={`/projects/${e.project.id}`} className="text-primary hover:underline">
                        {e.project.name}
                      </Link>
                    ) : e.case ? (
                      <Link href={`/cases/${e.case.id}`} className="text-primary hover:underline">
                        {e.case.caseNumber}
                      </Link>
                    ) : "—"}
                    {e.projectTask && <p className="text-xs text-muted-foreground">{e.projectTask.name}</p>}
                  </TD>
                  <TD className="whitespace-nowrap text-sm">{formatDate(e.workDate)}</TD>
                  <TD className="text-right tabular">
                    {formatNumber(e.hours, 2)}
                    {!e.billable && <p className="text-xs text-muted-foreground">non-billable</p>}
                  </TD>
                  <TD className="max-w-md text-sm text-muted-foreground">{e.description}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
