"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { logTime, updateTimeLog, deleteTimeLog, submitWeek } from "@/server/timesheets";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert, Badge, statusTone,
} from "@/components/ui";
import { cn, formatDate, formatNumber, humanize } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface Entry {
  id: string;
  workDate: string;
  hours: string;
  description: string;
  billable: boolean;
  approvalStatus: string;
  project: { id: string; name: string; projectNumber: string } | null;
  projectTask: { id: string; name: string } | null;
  case: { id: string; caseNumber: string; subject: string } | null;
}

export interface EntryOptions {
  projects: {
    id: string;
    name: string;
    projectNumber: string;
    tasks: { id: string; name: string; billable: boolean; assignedUserId: string | null }[];
  }[];
  cases: { id: string; caseNumber: string; subject: string }[];
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function TimesheetClient({
  weekStart,
  entries,
  options,
}: {
  weekStart: string;
  entries: Entry[];
  options: EntryOptions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [target, setTarget] = useState<"PROJECT" | "CASE">("PROJECT");

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const tasksForProject = options.projects.find((p) => p.id === projectId)?.tasks ?? [];
  const totalHours = entries.reduce((s, e) => s + Number(e.hours), 0);
  const billableHours = entries.filter((e) => e.billable).reduce((s, e) => s + Number(e.hours), 0);
  const submittable = entries.filter((e) => ["DRAFT", "REJECTED"].includes(e.approvalStatus));

  const hoursOn = (day: string) =>
    entries.filter((e) => e.workDate.slice(0, 10) === day).reduce((s, e) => s + Number(e.hours), 0);

  function save(fd: FormData, entryId: string | null) {
    setError(null);
    setNotice(null);
    const get = (k: string) => {
      const v = fd.get(k);
      return v === null || v === "" ? null : String(v);
    };

    const input = {
      projectId: target === "PROJECT" ? get("projectId") : null,
      projectTaskId: target === "PROJECT" ? get("projectTaskId") : null,
      caseId: target === "CASE" ? get("caseId") : null,
      workDate: get("workDate"),
      hours: get("hours"),
      description: String(fd.get("description") ?? ""),
      billable: fd.get("billable") === "on",
    } as never;

    startTransition(async () => {
      const result = entryId ? await updateTimeLog(entryId, input) : await logTime(input);
      if (result.ok) {
        setAdding(false);
        setEditingId(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteTimeLog(id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function submit() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await submitWeek(weekStart);
      if (result.ok) {
        setNotice(`${result.data.count} entr${result.data.count === 1 ? "y" : "ies"} submitted for approval.`);
        router.refresh();
      } else setError(result.error);
    });
  }

  const entryForm = (entry: Entry | null) => (
    <form action={(fd) => save(fd, entry?.id ?? null)} className="space-y-4">
      {!entry && (
        <div className="flex gap-2">
          {(["PROJECT", "CASE"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTarget(t)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                target === t ? "border-primary bg-primary/5 font-medium text-primary" : "hover:bg-accent",
              )}
            >
              {t === "PROJECT" ? "Project work" : "Support case"}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {!entry && target === "PROJECT" && (
          <>
            <Field label="Project" required>
              <Select
                name="projectId"
                required
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Select…</option>
                {options.projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.projectNumber} — {p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Task" hint={projectId ? undefined : "Pick a project first."}>
              <Select name="projectTaskId" disabled={!projectId}>
                <option value="">No specific task</option>
                {tasksForProject.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {!entry && target === "CASE" && (
          <div className="sm:col-span-2">
            <Field label="Support case" required>
              <Select name="caseId" required>
                <option value="">Select…</option>
                {options.cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.caseNumber} — {c.subject}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <Field label="Date" required>
          <Input
            name="workDate"
            type="date"
            required
            defaultValue={entry ? entry.workDate.slice(0, 10) : weekStart}
            min={weekStart}
            max={addDays(weekStart, 6)}
          />
        </Field>
        <Field label="Hours" required>
          <Input name="hours" type="number" step="0.25" min="0.25" max="24" required defaultValue={entry?.hours ?? ""} />
        </Field>
        <div className="sm:col-span-2 lg:col-span-4">
          <Field label="What you did" required>
            <Textarea name="description" rows={2} required defaultValue={entry?.description ?? ""} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="billable"
            defaultChecked={entry?.billable ?? true}
            className="h-4 w-4 rounded border-input"
          />
          Billable to the customer
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => { setAdding(false); setEditingId(null); }}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : entry ? "Save entry" : "Log time"}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="icon">
              <Link href={`/timesheets?week=${addDays(weekStart, -7)}`} aria-label="Previous week">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-[13rem] text-center">
              <p className="text-sm font-medium">
                {formatDate(weekStart)} – {formatDate(addDays(weekStart, 6))}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatNumber(totalHours, 2)}h logged · {formatNumber(billableHours, 2)}h billable
              </p>
            </div>
            <Button asChild variant="outline" size="icon">
              <Link href={`/timesheets?week=${addDays(weekStart, 7)}`} aria-label="Next week">
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAdding(!adding)}>
              {adding ? "Cancel" : <><Plus className="h-4 w-4" /> Log time</>}
            </Button>
            <Button type="button" size="sm" disabled={pending || submittable.length === 0} onClick={submit}>
              Submit week ({submittable.length})
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-7 gap-2">
            {days.map((day, i) => {
              const h = hoursOn(day);
              return (
                <div key={day} className={cn("rounded-md border p-2 text-center", h === 0 && "opacity-60")}>
                  <p className="text-xs font-medium text-muted-foreground">{DAYS[i]}</p>
                  <p className="mt-0.5 text-sm font-semibold tabular">{h > 0 ? formatNumber(h, 2) : "—"}</p>
                </div>
              );
            })}
          </div>

          {adding && <div className="rounded-md border bg-muted/30 p-4">{entryForm(null)}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entries</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing logged this week. You can book time to any project you are an active member of,
              or to a support case you own.
            </p>
          ) : (
            entries.map((e) => {
              const locked = e.approvalStatus === "APPROVED";
              return (
                <div key={e.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {e.project ? (
                          <Link href={`/projects/${e.project.id}`} className="hover:underline">
                            {e.project.name}
                          </Link>
                        ) : e.case ? (
                          <Link href={`/cases/${e.case.id}`} className="hover:underline">
                            {e.case.caseNumber} — {e.case.subject}
                          </Link>
                        ) : "Unlinked"}
                        {e.projectTask && (
                          <span className="text-muted-foreground"> · {e.projectTask.name}</span>
                        )}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{e.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold tabular">{formatNumber(e.hours, 2)}h</span>
                      {!e.billable && <Badge tone="neutral">Non-billable</Badge>}
                      <Badge tone={statusTone(e.approvalStatus)}>{humanize(e.approvalStatus)}</Badge>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatDate(e.workDate)}</span>
                    {!locked && (
                      <>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(editingId === e.id ? null : e.id)}>
                          Edit
                        </Button>
                        <Button type="button" variant="ghost" size="icon" disabled={pending} onClick={() => remove(e.id)} aria-label="Delete entry">
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </>
                    )}
                  </div>
                  {editingId === e.id && <div className="mt-3 border-t pt-3">{entryForm(e)}</div>}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
