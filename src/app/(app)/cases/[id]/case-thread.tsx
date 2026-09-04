"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare, Lock, Send, Timer, Pause, Play, Flag,
} from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardContent, Textarea, Select, Input, Button,
  Alert, Badge, Field,
} from "@/components/ui";
import { addCaseComment, applyPauseToDeadline, type CaseComment, type SlaEvent } from "@/server/case-thread";
import { formatDateTime, humanize } from "@/lib/utils";

const TYPE_LABEL: Record<string, { label: string; tone: "info" | "success" | "warning" }> = {
  CUSTOMER_COMMENT: { label: "From the customer", tone: "info" },
  AGENT_RESPONSE: { label: "Our reply", tone: "success" },
  INTERNAL_NOTE: { label: "Internal note", tone: "warning" },
};

/**
 * The case conversation.
 *
 * Posting can move the case at the same time, because replying and changing
 * state are one action in practice — a reply that asks the customer a question
 * puts the case on them, and doing that in two steps is how the SLA clock ends
 * up disagreeing with the thread.
 */
export function CaseThread({
  caseId,
  comments,
  events,
  pausedMinutes,
  currentStatus,
  canWrite,
}: {
  caseId: string;
  comments: CaseComment[];
  events: SlaEvent[];
  pausedMinutes: number;
  currentStatus: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState(false);

  function post(formData: FormData) {
    setError(null);
    start(async () => {
      const result = await addCaseComment(caseId, {
        body: String(formData.get("body") ?? ""),
        commentType: String(formData.get("commentType") ?? "AGENT_RESPONSE") as never,
        timeSpentMinutes: formData.get("timeSpentMinutes")
          ? Number(formData.get("timeSpentMinutes"))
          : null,
        newStatus: String(formData.get("newStatus") ?? "") || null,
      });

      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function extendDeadline() {
    setError(null);
    start(async () => {
      const result = await applyPauseToDeadline(caseId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  const totalTime = comments.reduce((sum, c) => sum + (c.timeSpentMinutes ?? 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          Conversation
          {comments.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {comments.length} · {totalTime > 0 ? `${totalTime}m logged` : "no time logged"}
            </span>
          )}
        </CardTitle>

        {events.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowEvents((v) => !v)}>
            <Timer className="h-3.5 w-3.5" /> {showEvents ? "Hide" : "SLA"} timeline
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {pausedMinutes > 0 && (
          <Alert tone="warning">
            <p>
              The clock has been paused for <strong>{pausedMinutes} minutes</strong> while waiting
              on someone else. The resolution deadline still reads as though it never stopped.
            </p>
            {canWrite && (
              <Button
                size="sm"
                variant="outline"
                onClick={extendDeadline}
                disabled={pending}
                className="mt-2"
              >
                Extend the deadline by {pausedMinutes}m
              </Button>
            )}
          </Alert>
        )}

        {showEvents && (
          <ul className="space-y-1.5 rounded-lg border bg-muted/20 p-3 text-xs">
            {events.map((e) => {
              const Icon =
                e.eventType === "PAUSED" ? Pause : e.eventType === "RESUMED" ? Play : Flag;
              return (
                <li key={e.id} className="flex items-center gap-2">
                  <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{humanize(e.eventType)}</span>
                  {e.reason && <span className="text-muted-foreground">: {e.reason}</span>}
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {formatDateTime(e.eventAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing recorded yet. What the customer said and what was tried belongs here - it is
            the only account of the work once the case is closed.
          </p>
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => {
              const meta = TYPE_LABEL[c.commentType] ?? TYPE_LABEL.INTERNAL_NOTE;
              const internal = c.commentType === "INTERNAL_NOTE";

              return (
                <li
                  key={c.id}
                  className={`rounded-lg border p-3 ${internal ? "border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20" : ""}`}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={meta.tone}>
                      {internal && <Lock className="h-3 w-3" />} {meta.label}
                    </Badge>
                    <span className="font-medium">
                      {c.author?.fullName ??
                        (c.authorContact
                          ? `${c.authorContact.firstName} ${c.authorContact.lastName}`
                          : "Unknown")}
                    </span>
                    <span className="text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                    {c.timeSpentMinutes ? (
                      <span className="ml-auto text-muted-foreground">
                        {c.timeSpentMinutes}m
                      </span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-line text-sm leading-relaxed">{c.body}</p>
                </li>
              );
            })}
          </ul>
        )}

        {canWrite && (
          <form action={post} className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <Textarea
              name="body"
              rows={4}
              required
              placeholder="What was said, what was tried, what happens next…"
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Type">
                <Select name="commentType" defaultValue="AGENT_RESPONSE" className="text-xs">
                  <option value="AGENT_RESPONSE">Our reply</option>
                  <option value="CUSTOMER_COMMENT">From the customer</option>
                  <option value="INTERNAL_NOTE">Internal note</option>
                </Select>
              </Field>

              <Field label="Move case to">
                <Select name="newStatus" defaultValue="" className="text-xs">
                  <option value="">Leave as {humanize(currentStatus)}</option>
                  {[
                    "IN_PROGRESS",
                    "WAITING_FOR_CUSTOMER",
                    "WAITING_FOR_INTERNAL_TEAM",
                    "WAITING_FOR_THIRD_PARTY",
                    "RESOLVED",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {humanize(s)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Time spent (min)">
                <Input name="timeSpentMinutes" type="number" min="0" className="text-xs" />
              </Field>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                <Send className="h-4 w-4" /> {pending ? "Posting…" : "Post"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
