"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, CornerDownRight } from "lucide-react";
import {
  createTask, updateTask, changeTaskStatus,
  createPhase, deletePhase,
  createMilestone, completeMilestone,
  addProjectMember, updateProjectMember, removeProjectMember,
  createRisk, createIssue,
} from "@/server/projects";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert, Badge, statusTone, Table, THead, TBody, TR, TH, TD,
} from "@/components/ui";
import { cn, formatDate, formatMoney, formatPercent, humanize } from "@/lib/utils";

const TASK_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "UNDER_REVIEW", "COMPLETED"];
const ALL_TASK_STATUSES = [...TASK_STATUSES, "CANCELLED"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export interface Member {
  id: string;
  userId: string;
  projectRole: string;
  allocationPercent: string | null;
  billingRate: string | null;
  costRate: string | null;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  user: { id: string; fullName: string; jobTitle: string | null; email: string };
}

export interface Task {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  assignedUserId: string | null;
  assignedUser: { id: string; fullName: string } | null;
  phaseId: string | null;
  milestoneId: string | null;
  parentTaskId: string | null;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: string | null;
  completionPercent: string;
  billable: boolean;
  acceptanceCriteria: string | null;
  _count: { subtasks: number };
}

export interface Phase {
  id: string;
  name: string;
  sequenceNumber: number;
  status: string;
  completionPercent: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  budgetedHours: string | null;
}

export interface MilestoneRow {
  id: string;
  name: string;
  dueDate: string;
  completedDate: string | null;
  status: string;
  customerApprovalRequired: boolean;
  customerApprovalDate: string | null;
  billingTrigger: boolean;
  billingAmount: string | null;
  billingPercent: string | null;
  invoicedAt: string | null;
  owner: { id: string; fullName: string } | null;
  phase: { id: string; name: string } | null;
}

interface UserOption {
  id: string;
  fullName: string;
  jobTitle: string | null;
}

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/** Shared shell for the "click Add, get a form" pattern used across the panels. */
function AddSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={onToggle}>
        {open ? "Cancel" : <><Plus className="h-4 w-4" /> {label}</>}
      </Button>
      {open && <div className="mt-4 rounded-md border bg-muted/30 p-4">{children}</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function TaskBoard({
  projectId,
  tasks,
  phases,
  milestones,
  members,
}: {
  projectId: string;
  tasks: Task[];
  phases: Phase[];
  milestones: MilestoneRow[];
  members: Member[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "list">("board");
  const [parentFor, setParentFor] = useState<string | null>(null);

  const assignable = members.filter((m) => m.active);
  const topLevel = tasks.filter((t) => !t.parentTaskId);
  const subtasksOf = (id: string) => tasks.filter((t) => t.parentTaskId === id);

  function submitTask(formData: FormData, taskId: string | null, parentTaskId: string | null) {
    setError(null);
    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };

    const input = {
      projectId,
      phaseId: get("phaseId"),
      milestoneId: get("milestoneId"),
      parentTaskId,
      name: String(formData.get("name") ?? ""),
      description: get("description"),
      assignedUserId: get("assignedUserId"),
      status: get("status") ?? "NOT_STARTED",
      priority: get("priority") ?? "MEDIUM",
      startDate: get("startDate"),
      dueDate: get("dueDate"),
      estimatedHours: get("estimatedHours"),
      completionPercent: get("completionPercent"),
      billable: formData.get("billable") === "on",
      acceptanceCriteria: get("acceptanceCriteria"),
    } as never;

    startTransition(async () => {
      const result = taskId ? await updateTask(taskId, input) : await createTask(input);
      if (result.ok) {
        setAdding(false);
        setEditingId(null);
        setParentFor(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function quickStatus(taskId: string, status: string) {
    setError(null);
    startTransition(async () => {
      const result = await changeTaskStatus(taskId, status);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  const taskForm = (task: Task | null, parentTaskId: string | null) => (
    <form action={(fd) => submitTask(fd, task?.id ?? null, parentTaskId)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Task" required>
            <Input name="name" required defaultValue={task?.name} placeholder="Configure the chart of accounts" />
          </Field>
        </div>
        <Field label="Assignee" hint="Must be on the project team.">
          <Select name="assignedUserId" defaultValue={task?.assignedUserId ?? ""}>
            <option value="">Unassigned</option>
            {assignable.map((m) => (
              <option key={m.userId} value={m.userId}>{m.user?.fullName} — {m.projectRole}</option>
            ))}
          </Select>
        </Field>
        <Field label="Phase">
          <Select name="phaseId" defaultValue={task?.phaseId ?? ""}>
            <option value="">No phase</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>{p.sequenceNumber}. {p.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Milestone">
          <Select name="milestoneId" defaultValue={task?.milestoneId ?? ""}>
            <option value="">No milestone</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={task?.status ?? "NOT_STARTED"}>
            {ALL_TASK_STATUSES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select name="priority" defaultValue={task?.priority ?? "MEDIUM"}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{humanize(p)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Estimated hours" hint="Also the weight used for progress roll-up.">
          <Input name="estimatedHours" type="number" step="0.5" min="0" defaultValue={task?.estimatedHours ?? ""} />
        </Field>
        <Field label="Start date">
          <Input name="startDate" type="date" defaultValue={dateInput(task?.startDate ?? null)} />
        </Field>
        <Field label="Due date">
          <Input name="dueDate" type="date" defaultValue={dateInput(task?.dueDate ?? null)} />
        </Field>
        <Field label="Percent complete">
          <Input
            name="completionPercent"
            type="number"
            min="0"
            max="100"
            defaultValue={task ? Number(task.completionPercent).toFixed(0) : "0"}
          />
        </Field>
        <div className="flex items-end">
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              name="billable"
              defaultChecked={task?.billable ?? true}
              className="h-4 w-4 rounded border-input"
            />
            Billable
          </label>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description">
            <Textarea name="description" rows={2} defaultValue={task?.description ?? ""} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Acceptance criteria" hint="What 'done' means — the thing arguments are avoided with.">
            <Textarea name="acceptanceCriteria" rows={2} defaultValue={task?.acceptanceCriteria ?? ""} />
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => { setAdding(false); setEditingId(null); setParentFor(null); }}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : task ? "Save task" : "Add task"}
        </Button>
      </div>
    </form>
  );

  const taskCard = (t: Task, isSub = false) => (
    <div
      key={t.id}
      className={cn(
        "rounded-md border bg-card p-3",
        isSub && "ml-5 border-dashed",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {isSub && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <Link
              href={`/projects/${projectId}/tasks/${t.id}`}
              className="truncate hover:underline"
            >
              {t.name}
            </Link>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t.assignedUser ? t.assignedUser?.fullName : "Unassigned"}
            {t.dueDate && ` · due ${formatDate(t.dueDate)}`}
            {t.estimatedHours && ` · ${Number(t.estimatedHours)}h`}
            {!t.billable && " · non-billable"}
          </p>
        </div>
        <Badge tone={statusTone(t.priority)}>{humanize(t.priority)}</Badge>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Select
          className="h-7 w-auto text-xs"
          value={t.status}
          disabled={pending}
          onChange={(e) => quickStatus(t.id, e.target.value)}
        >
          {ALL_TASK_STATUSES.map((s) => (
            <option key={s} value={s}>{humanize(s)}</option>
          ))}
        </Select>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(editingId === t.id ? null : t.id)}>
          Edit
        </Button>
        {!isSub && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setParentFor(parentFor === t.id ? null : t.id)}>
            Subtask
          </Button>
        )}
        {t._count.subtasks > 0 && (
          <span className="text-xs text-muted-foreground">{t._count.subtasks} subtask(s)</span>
        )}
      </div>

      {editingId === t.id && <div className="mt-3 border-t pt-3">{taskForm(t, t.parentTaskId)}</div>}
      {parentFor === t.id && (
        <div className="mt-3 border-t pt-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">New subtask of “{t.name}”</p>
          {taskForm(null, t.id)}
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Tasks</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Completing tasks rolls progress up into phases and the project — the percentage is never typed in.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select className="h-8 w-28 text-xs" value={view} onChange={(e) => setView(e.target.value as never)}>
            <option value="board">Board</option>
            <option value="list">List</option>
          </Select>
          <AddSection label="Add task" open={adding} onToggle={() => { setAdding(!adding); setEditingId(null); }}>
            {taskForm(null, null)}
          </AddSection>
        </div>
      </CardHeader>
      <CardContent>
        {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}

        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tasks yet. Add the first one — until then the project shows 0% because nothing has been planned.
          </p>
        ) : view === "board" ? (
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {TASK_STATUSES.map((status) => {
              const column = tasks.filter((t) => t.status === status);
              return (
                <div key={status} className="rounded-lg bg-muted/40 p-2">
                  <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {humanize(status)} <span className="ml-1 font-normal">{column.length}</span>
                  </p>
                  <div className="space-y-2">
                    {column.map((t) => taskCard(t, Boolean(t.parentTaskId)))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {topLevel.map((t) => (
              <div key={t.id} className="space-y-2">
                {taskCard(t)}
                {subtasksOf(t.id).map((s) => taskCard(s, true))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Team / resources
// ---------------------------------------------------------------------------

export function TeamPanel({
  projectId,
  members,
  users,
  currency,
}: {
  projectId: string;
  members: Member[];
  users: UserOption[];
  currency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const memberIds = new Set(members.map((m) => m.userId));
  const available = users.filter((u) => !memberIds.has(u.id));

  function add(formData: FormData) {
    setError(null);
    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };
    startTransition(async () => {
      const result = await addProjectMember({
        projectId,
        userId: String(formData.get("userId") ?? ""),
        projectRole: String(formData.get("projectRole") ?? ""),
        allocationPercent: get("allocationPercent"),
        startDate: get("startDate"),
        endDate: get("endDate"),
        billingRate: get("billingRate"),
        costRate: get("costRate"),
      } as never);
      if (result.ok) { setAdding(false); router.refresh(); }
      else setError(result.error);
    });
  }

  function save(id: string, formData: FormData) {
    setError(null);
    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };
    startTransition(async () => {
      const result = await updateProjectMember(id, {
        projectRole: String(formData.get("projectRole") ?? ""),
        allocationPercent: get("allocationPercent"),
        startDate: get("startDate"),
        endDate: get("endDate"),
        billingRate: get("billingRate"),
        costRate: get("costRate"),
        active: formData.get("active") === "on",
      } as never);
      if (result.ok) { setEditingId(null); router.refresh(); }
      else setError(result.error);
    });
  }

  function remove(id: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await removeProjectMember(id);
      if (result.ok) {
        if (result.data.deactivated) {
          setNotice("They have logged time on this project, so they were deactivated rather than removed — their hours stay attached to them.");
        }
        router.refresh();
      } else setError(result.error);
    });
  }

  const totalAllocation = members
    .filter((m) => m.active)
    .reduce((s, m) => s + Number(m.allocationPercent ?? 0), 0);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Team</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {members.filter((m) => m.active).length} active · {totalAllocation}% total allocation booked
          </p>
        </div>
        <AddSection label="Add person" open={adding} onToggle={() => setAdding(!adding)}>
          <form action={add} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Person" required>
                <Select name="userId" required>
                  <option value="">Select…</option>
                  {available.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}{u.jobTitle ? ` — ${u.jobTitle}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Role on project" required>
                <Input name="projectRole" required placeholder="Business Analyst" />
              </Field>
              <Field label="Allocation %" hint="Share of their week booked to this project.">
                <Input name="allocationPercent" type="number" min="0" max="100" placeholder="50" />
              </Field>
              <Field label="From">
                <Input name="startDate" type="date" />
              </Field>
              <Field label="Until">
                <Input name="endDate" type="date" />
              </Field>
              <Field label="Billing rate" hint="Blank uses their standard rate.">
                <Input name="billingRate" type="number" step="0.01" min="0" />
              </Field>
              <Field label="Cost rate" hint="Blank uses their standard cost.">
                <Input name="costRate" type="number" step="0.01" min="0" />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Adding…" : "Add to project"}
              </Button>
            </div>
          </form>
        </AddSection>
      </CardHeader>

      <CardContent className="px-0">
        {(error || notice) && (
          <div className="px-5 pb-3">
            {error && <Alert tone="danger">{error}</Alert>}
            {notice && <Alert tone="info">{notice}</Alert>}
          </div>
        )}

        {members.length === 0 ? (
          <p className="px-5 pb-2 text-sm text-muted-foreground">Nobody booked on this project yet.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH>Role</TH>
                <TH className="text-right">Allocation</TH>
                <TH className="text-right">Billing rate</TH>
                <TH className="text-right">Cost rate</TH>
                <TH>Window</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {members.map((m) => (
                <Fragment key={m.id}>
                  <TR className={cn(!m.active && "opacity-55")}>
                    <TD>
                      <Link href={`/resources#${m.userId}`} className="font-medium hover:underline">
                        {m.user?.fullName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{m.user?.jobTitle ?? "—"}</p>
                    </TD>
                    <TD className="text-sm">{m.projectRole}</TD>
                    <TD className="text-right tabular">{formatPercent(m.allocationPercent, 0)}</TD>
                    <TD className="text-right tabular">{formatMoney(m.billingRate, currency)}</TD>
                    <TD className="text-right tabular">{formatMoney(m.costRate, currency)}</TD>
                    <TD className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(m.startDate)} → {formatDate(m.endDate)}
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(editingId === m.id ? null : m.id)}>
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" size="icon" disabled={pending} onClick={() => remove(m.id)} aria-label="Remove">
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TD>
                  </TR>
                  {editingId === m.id && (
                    <TR>
                      <TD colSpan={7} className="bg-muted/30">
                        <form action={(fd) => save(m.id, fd)} className="space-y-4 py-2">
                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <Field label="Role on project" required>
                              <Input name="projectRole" required defaultValue={m.projectRole} />
                            </Field>
                            <Field label="Allocation %">
                              <Input name="allocationPercent" type="number" min="0" max="100" defaultValue={m.allocationPercent ?? ""} />
                            </Field>
                            <Field label="Billing rate">
                              <Input name="billingRate" type="number" step="0.01" min="0" defaultValue={m.billingRate ?? ""} />
                            </Field>
                            <Field label="Cost rate">
                              <Input name="costRate" type="number" step="0.01" min="0" defaultValue={m.costRate ?? ""} />
                            </Field>
                            <Field label="From">
                              <Input name="startDate" type="date" defaultValue={dateInput(m.startDate)} />
                            </Field>
                            <Field label="Until">
                              <Input name="endDate" type="date" defaultValue={dateInput(m.endDate)} />
                            </Field>
                            <div className="flex items-end">
                              <label className="flex items-center gap-2 pb-2 text-sm">
                                <input type="checkbox" name="active" defaultChecked={m.active} className="h-4 w-4 rounded border-input" />
                                Active on the project
                              </label>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                            <Button type="submit" size="sm" disabled={pending}>Save</Button>
                          </div>
                        </form>
                      </TD>
                    </TR>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Phases and milestones
// ---------------------------------------------------------------------------

export function PlanPanel({
  projectId,
  phases,
  milestones,
  users,
  currency,
  contractValue,
}: {
  projectId: string;
  phases: Phase[];
  milestones: MilestoneRow[];
  users: UserOption[];
  currency: string;
  contractValue: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addingPhase, setAddingPhase] = useState(false);
  const [addingMilestone, setAddingMilestone] = useState(false);
  const [billingTrigger, setBillingTrigger] = useState(false);

  const get = (fd: FormData, k: string) => {
    const v = fd.get(k);
    return v === null || v === "" ? null : String(v);
  };

  function addPhase(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createPhase({
        projectId,
        name: String(fd.get("name") ?? ""),
        ownerUserId: get(fd, "ownerUserId"),
        plannedStart: get(fd, "plannedStart"),
        plannedEnd: get(fd, "plannedEnd"),
        budgetedHours: get(fd, "budgetedHours"),
      } as never);
      if (result.ok) { setAddingPhase(false); router.refresh(); }
      else setError(result.error);
    });
  }

  function addMilestone(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createMilestone({
        projectId,
        phaseId: get(fd, "phaseId"),
        name: String(fd.get("name") ?? ""),
        description: get(fd, "description"),
        ownerUserId: get(fd, "ownerUserId"),
        dueDate: get(fd, "dueDate"),
        status: "PLANNED",
        customerApprovalRequired: fd.get("customerApprovalRequired") === "on",
        billingTrigger: fd.get("billingTrigger") === "on",
        billingPercent: get(fd, "billingPercent"),
        billingAmount: get(fd, "billingAmount"),
      } as never);
      if (result.ok) { setAddingMilestone(false); setBillingTrigger(false); router.refresh(); }
      else setError(result.error);
    });
  }

  function complete(id: string, needsApproval: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await completeMilestone(id, needsApproval);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function removePhase(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deletePhase(id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Phases group the work; milestones are what the customer signs off — and, where marked, what triggers an invoice.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <Alert tone="danger">{error}</Alert>}

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Phases</h4>
            <AddSection label="Add phase" open={addingPhase} onToggle={() => setAddingPhase(!addingPhase)}>
              <form action={addPhase} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Phase name" required>
                    <Input name="name" required placeholder="Discovery" />
                  </Field>
                  <Field label="Owner">
                    <Select name="ownerUserId">
                      <option value="">Unassigned</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                    </Select>
                  </Field>
                  <Field label="Budgeted hours">
                    <Input name="budgetedHours" type="number" step="0.5" min="0" />
                  </Field>
                  <Field label="Planned start">
                    <Input name="plannedStart" type="date" />
                  </Field>
                  <Field label="Planned end">
                    <Input name="plannedEnd" type="date" />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={pending}>Add phase</Button>
                </div>
              </form>
            </AddSection>
          </div>

          {phases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No phases. Tasks can still be created without one.</p>
          ) : (
            <div className="space-y-2">
              {phases.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-md border p-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">
                    {p.sequenceNumber}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(p.plannedStart)} → {formatDate(p.plannedEnd)}
                      {p.budgetedHours && ` · ${Number(p.budgetedHours)}h budgeted`}
                    </p>
                  </div>
                  <div className="w-28 shrink-0">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${Number(p.completionPercent)}%` }} />
                    </div>
                    <p className="mt-1 text-right text-xs tabular text-muted-foreground">
                      {formatPercent(p.completionPercent, 0)}
                    </p>
                  </div>
                  <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
                  <Button type="button" variant="ghost" size="icon" disabled={pending} onClick={() => removePhase(p.id)} aria-label="Delete phase">
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Milestones</h4>
            <AddSection label="Add milestone" open={addingMilestone} onToggle={() => setAddingMilestone(!addingMilestone)}>
              <form action={addMilestone} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Milestone" required>
                    <Input name="name" required placeholder="UAT sign-off" />
                  </Field>
                  <Field label="Due date" required>
                    <Input name="dueDate" type="date" required />
                  </Field>
                  <Field label="Phase">
                    <Select name="phaseId">
                      <option value="">No phase</option>
                      {phases.map((p) => <option key={p.id} value={p.id}>{p.sequenceNumber}. {p.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Owner">
                    <Select name="ownerUserId">
                      <option value="">Unassigned</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                    </Select>
                  </Field>
                  <div className="space-y-2 pt-6 sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="customerApprovalRequired" className="h-4 w-4 rounded border-input" />
                      Needs customer sign-off before it can be completed
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="billingTrigger"
                        checked={billingTrigger}
                        onChange={(e) => setBillingTrigger(e.target.checked)}
                        className="h-4 w-4 rounded border-input"
                      />
                      Reaching this milestone triggers an invoice
                    </label>
                  </div>
                  {billingTrigger && (
                    <>
                      <Field label="Bill amount" hint="Or use a percentage instead.">
                        <Input name="billingAmount" type="number" step="0.01" min="0" />
                      </Field>
                      <Field
                        label="Bill % of contract"
                        hint={contractValue ? `Contract value ${formatMoney(contractValue, currency)}` : "No contract value set."}
                      >
                        <Input name="billingPercent" type="number" step="0.01" min="0" max="100" />
                      </Field>
                    </>
                  )}
                  <div className="sm:col-span-3">
                    <Field label="Description">
                      <Textarea name="description" rows={2} />
                    </Field>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={pending}>Add milestone</Button>
                </div>
              </form>
            </AddSection>
          </div>

          {milestones.length === 0 ? (
            <p className="text-sm text-muted-foreground">No milestones set.</p>
          ) : (
            <div className="space-y-2">
              {milestones.map((m) => {
                const overdue = !m.completedDate && new Date(m.dueDate) < new Date();
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{m.name}</p>
                      <p className={cn("text-xs", overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                        due {formatDate(m.dueDate)}
                        {m.phase && ` · ${m.phase?.name}`}
                        {m.owner && ` · ${m.owner?.fullName}`}
                      </p>
                    </div>
                    {m.billingTrigger && (
                      <Badge tone={m.invoicedAt ? "success" : "warning"}>
                        {m.invoicedAt
                          ? "Invoiced"
                          : m.billingAmount
                            ? `Bills ${formatMoney(m.billingAmount, currency)}`
                            : `Bills ${formatPercent(m.billingPercent, 0)}`}
                      </Badge>
                    )}
                    {m.customerApprovalRequired && (
                      <Badge tone={m.customerApprovalDate ? "success" : "neutral"}>
                        {m.customerApprovalDate ? "Signed off" : "Sign-off required"}
                      </Badge>
                    )}
                    <Badge tone={statusTone(m.status)}>{humanize(m.status)}</Badge>
                    {m.status !== "COMPLETED" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => complete(m.id, m.customerApprovalRequired)}
                      >
                        Complete
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Risks and issues
// ---------------------------------------------------------------------------

export function RaidPanel({
  projectId,
  risks,
  issues,
  users,
}: {
  projectId: string;
  risks: {
    id: string; title: string; description: string; probability: string; impact: string;
    riskScore: number; status: string; targetDate: string | null; mitigationPlan: string | null;
    owner: { id: string; fullName: string };
  }[];
  issues: {
    id: string; title: string; description: string; severity: string; status: string;
    dueDate: string | null; owner: { id: string; fullName: string };
  }[];
  users: UserOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addingRisk, setAddingRisk] = useState(false);
  const [addingIssue, setAddingIssue] = useState(false);

  const get = (fd: FormData, k: string) => {
    const v = fd.get(k);
    return v === null || v === "" ? null : String(v);
  };

  function addRisk(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createRisk({
        projectId,
        title: String(fd.get("title") ?? ""),
        description: String(fd.get("description") ?? ""),
        probability: get(fd, "probability"),
        impact: get(fd, "impact"),
        mitigationPlan: get(fd, "mitigationPlan"),
        ownerUserId: String(fd.get("ownerUserId") ?? ""),
        targetDate: get(fd, "targetDate"),
        status: "OPEN",
      } as never);
      if (result.ok) { setAddingRisk(false); router.refresh(); }
      else setError(result.error);
    });
  }

  function addIssue(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createIssue({
        projectId,
        title: String(fd.get("title") ?? ""),
        description: String(fd.get("description") ?? ""),
        severity: get(fd, "severity"),
        ownerUserId: String(fd.get("ownerUserId") ?? ""),
        resolutionPlan: get(fd, "resolutionPlan"),
        dueDate: get(fd, "dueDate"),
        status: "OPEN",
      } as never);
      if (result.ok) { setAddingIssue(false); router.refresh(); }
      else setError(result.error);
    });
  }

  const scoreTone = (score: number) =>
    score >= 9 ? "danger" : score >= 4 ? "warning" : "neutral";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Risks and issues</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          A risk might happen; an issue already has. Risk score is probability × impact.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <Alert tone="danger">{error}</Alert>}

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Risks ({risks.filter((r) => r.status === "OPEN").length} open)</h4>
            <AddSection label="Log risk" open={addingRisk} onToggle={() => setAddingRisk(!addingRisk)}>
              <form action={addRisk} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="lg:col-span-3">
                    <Field label="Risk" required>
                      <Input name="title" required placeholder="Customer's data migration file may not arrive on time" />
                    </Field>
                  </div>
                  <Field label="Probability" required>
                    <Select name="probability" required defaultValue="MEDIUM">
                      {LEVELS.map((l) => <option key={l} value={l}>{humanize(l)}</option>)}
                    </Select>
                  </Field>
                  <Field label="Impact" required>
                    <Select name="impact" required defaultValue="MEDIUM">
                      {LEVELS.map((l) => <option key={l} value={l}>{humanize(l)}</option>)}
                    </Select>
                  </Field>
                  <Field label="Owner" required>
                    <Select name="ownerUserId" required>
                      <option value="">Select…</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                    </Select>
                  </Field>
                  <Field label="Target date">
                    <Input name="targetDate" type="date" />
                  </Field>
                  <div className="lg:col-span-3">
                    <Field label="Description" required>
                      <Textarea name="description" rows={2} required />
                    </Field>
                  </div>
                  <div className="lg:col-span-3">
                    <Field label="Mitigation plan">
                      <Textarea name="mitigationPlan" rows={2} />
                    </Field>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={pending}>Log risk</Button>
                </div>
              </form>
            </AddSection>
          </div>

          {risks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No risks logged.</p>
          ) : (
            <div className="space-y-2">
              {risks.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <Badge tone={scoreTone(r.riskScore)}>{r.riskScore}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {humanize(r.probability)} probability · {humanize(r.impact)} impact · {r.owner?.fullName}
                      {r.targetDate && ` · by ${formatDate(r.targetDate)}`}
                    </p>
                  </div>
                  <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Issues ({issues.filter((i) => i.status === "OPEN").length} open)</h4>
            <AddSection label="Log issue" open={addingIssue} onToggle={() => setAddingIssue(!addingIssue)}>
              <form action={addIssue} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="lg:col-span-3">
                    <Field label="Issue" required>
                      <Input name="title" required />
                    </Field>
                  </div>
                  <Field label="Severity" required>
                    <Select name="severity" required defaultValue="MEDIUM">
                      {LEVELS.map((l) => <option key={l} value={l}>{humanize(l)}</option>)}
                    </Select>
                  </Field>
                  <Field label="Owner" required>
                    <Select name="ownerUserId" required>
                      <option value="">Select…</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                    </Select>
                  </Field>
                  <Field label="Due date">
                    <Input name="dueDate" type="date" />
                  </Field>
                  <div className="lg:col-span-3">
                    <Field label="Description" required>
                      <Textarea name="description" rows={2} required />
                    </Field>
                  </div>
                  <div className="lg:col-span-3">
                    <Field label="Resolution plan">
                      <Textarea name="resolutionPlan" rows={2} />
                    </Field>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={pending}>Log issue</Button>
                </div>
              </form>
            </AddSection>
          </div>

          {issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issues logged.</p>
          ) : (
            <div className="space-y-2">
              {issues.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <Badge tone={statusTone(i.severity)}>{humanize(i.severity)}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{i.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.owner?.fullName}
                      {i.dueDate && ` · due ${formatDate(i.dueDate)}`}
                    </p>
                  </div>
                  <Badge tone={statusTone(i.status)}>{humanize(i.status)}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
