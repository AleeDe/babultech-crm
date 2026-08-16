"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GripVertical, Clock, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge, statusTone, Alert } from "@/components/ui";
import { changeTaskStatus } from "@/server/projects";
import { formatDate, formatNumber, humanize, cn } from "@/lib/utils";

type Task = Record<string, any> & { id: string };

const COLUMNS = [
  { status: "NOT_STARTED", label: "To do" },
  { status: "IN_PROGRESS", label: "In progress" },
  { status: "BLOCKED", label: "Blocked" },
  { status: "UNDER_REVIEW", label: "In review" },
  { status: "COMPLETED", label: "Done" },
] as const;

/**
 * Tasks as a board.
 *
 * The list view answers "what is on this project"; the board answers "where is
 * the work stuck", which is the question a stand-up actually asks.
 *
 * Drag and drop uses the HTML drag events rather than a library: five columns
 * of cards is the whole requirement, and a drag library would be more code than
 * the feature. Every drop goes through the same changeTaskStatus action the
 * list uses, so the rules cannot diverge between the two views.
 *
 * Cancelled tasks are deliberately absent. A board is for work in flight, and a
 * column of abandoned cards is noise on every screen forever.
 */
export function TaskBoardView({
  projectId,
  tasks,
  canWrite,
}: {
  projectId: string;
  tasks: Task[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const live = tasks.filter((t) => t.status !== "CANCELLED");

  function move(taskId: string, status: string) {
    const task = live.find((t) => t.id === taskId);
    if (!task || task.status === status) return;

    setError(null);
    start(async () => {
      const result = await changeTaskStatus(taskId, status);
      if (result.ok) router.refresh();
      else setError(result.error ?? "That move was not allowed.");
    });
  }

  const now = new Date();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Board</CardTitle>
        <CardDescription>
          {canWrite
            ? "Drag a card to move it. Cancelled tasks are hidden — the board is for work in flight."
            : "Where the work stands. Cancelled tasks are hidden."}
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0">
        {error && (
          <div className="mb-3 px-5">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}

        {live.length === 0 ? (
          <p className="px-5 pb-2 text-sm text-muted-foreground">
            No tasks yet. Add them below and they appear here.
          </p>
        ) : (
          <div className="table-scroll px-5 pb-1">
            <div className="flex min-w-[900px] gap-3">
              {COLUMNS.map((column) => {
                const columnTasks = live.filter((t) => t.status === column.status);
                const isTarget = dragOver === column.status;

                return (
                  <div
                    key={column.status}
                    onDragOver={(e) => {
                      if (!canWrite) return;
                      e.preventDefault();
                      setDragOver(column.status);
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(null);
                      if (canWrite && dragging) move(dragging, column.status);
                      setDragging(null);
                    }}
                    className={cn(
                      "flex-1 rounded-lg border bg-muted/20 p-2 transition-colors",
                      isTarget && "border-primary bg-primary/5",
                      pending && "opacity-70",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {column.label}
                      </span>
                      <span className="text-xs tabular text-muted-foreground">
                        {columnTasks.length}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {columnTasks.map((t) => {
                        const overdue =
                          t.dueDate &&
                          !["COMPLETED", "CANCELLED"].includes(t.status) &&
                          new Date(t.dueDate) < now;

                        return (
                          <div
                            key={t.id}
                            draggable={canWrite}
                            onDragStart={() => setDragging(t.id)}
                            onDragEnd={() => {
                              setDragging(null);
                              setDragOver(null);
                            }}
                            className={cn(
                              "rounded-md border bg-card p-2.5 text-sm shadow-sm",
                              canWrite && "cursor-grab active:cursor-grabbing",
                              dragging === t.id && "opacity-40",
                            )}
                          >
                            <div className="flex items-start gap-1.5">
                              {canWrite && (
                                <GripVertical
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                  aria-hidden
                                />
                              )}
                              <Link
                                href={`/projects/${projectId}/tasks/${t.id}`}
                                className="min-w-0 flex-1 font-medium leading-snug hover:underline"
                              >
                                {t.name}
                              </Link>
                            </div>

                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <Badge tone={statusTone(t.priority)}>{humanize(t.priority)}</Badge>
                              {t.assignedUser?.fullName && (
                                <span className="truncate">{t.assignedUser.fullName}</span>
                              )}
                            </div>

                            {(t.dueDate || t.estimatedHours) && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                                {t.dueDate && (
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1",
                                      overdue
                                        ? "text-red-600 dark:text-red-400"
                                        : "text-muted-foreground",
                                    )}
                                  >
                                    {overdue && <AlertTriangle className="h-3 w-3" />}
                                    {formatDate(t.dueDate)}
                                  </span>
                                )}
                                {t.estimatedHours ? (
                                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    {formatNumber(t.estimatedHours, 0)}h
                                  </span>
                                ) : null}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {columnTasks.length === 0 && (
                        <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                          {isTarget ? "Drop here" : "Empty"}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
