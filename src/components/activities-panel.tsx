"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Mail, CalendarDays, NotebookPen, Plus, Trash2,
  MailOpen, MousePointerClick, MailX, AlertTriangle,
} from "lucide-react";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle,
  EmptyState, Field, Input, Select, Textarea, statusTone,
} from "@/components/ui";
import { saveActivity, deleteActivity, type ActivityRow } from "@/server/activities";
import { formatDateTime, humanize } from "@/lib/utils";

/**
 * Everything we have done with one record, and a way to add to it.
 *
 * The same panel on a lead, a customer and a partner, because an activity is
 * the same thing wherever it happens - only what it points at differs. One
 * component means one place to fix a bug rather than three that drift.
 *
 * Emails are read-only here. They were sent; there is nothing to edit, and what
 * matters about them is what the recipient did, which is shown as badges rather
 * than buried in fields.
 */
export function ActivitiesPanel({
  entityType,
  entityId,
  activities,
  canWrite,
}: {
  entityType: "Lead" | "Contact" | "Account" | "Partner" | "Opportunity";
  entityId: string;
  activities: ActivityRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function add(fd: FormData) {
    setError(null);
    const text = (key: string) => String(fd.get(key) ?? "");

    start(async () => {
      const result = await saveActivity({
        activityType: text("activityType") as "LOG" | "EVENT",
        subject: text("subject"),
        description: text("description"),
        relatedEntityType: entityType,
        relatedEntityId: entityId,
        // An event with a date ahead of it is still to happen; a log is a record
        // of something that already did.
        status: text("activityType") === "EVENT" && text("startAt") ? "OPEN" : "COMPLETED",
        priority: "MEDIUM",
        outcome: text("outcome"),
        location: text("location"),
        startAt: text("startAt"),
        dueAt: "",
      });

      if (result.ok) {
        setAdding(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  function remove(id: string, subject: string) {
    if (!window.confirm(`Remove "${subject}" from the history?`)) return;
    setError(null);
    start(async () => {
      const result = await deleteActivity(id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  const icon = (type: string) => {
    if (type === "EMAIL") return <Mail className="h-4 w-4 text-muted-foreground" />;
    if (type === "EVENT") return <CalendarDays className="h-4 w-4 text-muted-foreground" />;
    return <NotebookPen className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Activities</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Emails sent, events attended and contact logged.
          </p>
        </div>
        {canWrite && (
          <Button variant="outline" size="sm" onClick={() => setAdding(!adding)} disabled={pending}>
            <Plus className="h-4 w-4" /> {adding ? "Cancel" : "Log something"}
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {adding && (
          <form action={add} className="grid gap-4 rounded-md border bg-muted/30 p-4 sm:grid-cols-2">
            <Field label="Kind" required>
              <Select name="activityType" defaultValue="LOG" required>
                <option value="LOG">Log — something that has happened</option>
                <option value="EVENT">Event — something with a time and place</option>
              </Select>
            </Field>
            <Field label="Subject" required>
              <Input name="subject" required maxLength={255} placeholder="Called about the proposal" />
            </Field>
            <Field label="When" help="Leave blank for a log of something that just happened.">
              <Input name="startAt" type="datetime-local" />
            </Field>
            <Field label="Where">
              <Input name="location" maxLength={255} placeholder="Their office, or a meeting link" />
            </Field>
            <Field label="What happened">
              <Textarea name="description" rows={3} maxLength={8000} />
            </Field>
            <Field label="Outcome" help="What it led to, if anything.">
              <Textarea name="outcome" rows={3} maxLength={4000} />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save activity"}
              </Button>
            </div>
          </form>
        )}

        {activities.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Emails you send appear here automatically. Calls, meetings and visits can be logged by hand."
          />
        ) : (
          <ul className="divide-y">
            {activities.map((a) => (
              <li key={a.id} className="flex gap-3 py-3">
                <span className="mt-0.5 shrink-0">{icon(a.activityType)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{a.subject}</p>
                    <Badge tone="neutral">{humanize(a.activityType)}</Badge>
                    {a.status !== "COMPLETED" && (
                      <Badge tone={statusTone(a.status)}>{humanize(a.status)}</Badge>
                    )}
                  </div>

                  {a.activityType === "EMAIL" ? (
                    // What the recipient did, which is the whole point of an
                    // email activity. Clicks first: an open can be a mail client
                    // pre-fetching an image, a click cannot.
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{a.sentAt ? `Sent ${formatDateTime(a.sentAt)}` : "Not sent"}</span>
                      {a.clickCount > 0 && (
                        <span className="inline-flex items-center gap-1 font-medium text-foreground">
                          <MousePointerClick className="h-3.5 w-3.5" />
                          {a.clickCount} click{a.clickCount === 1 ? "" : "s"}
                        </span>
                      )}
                      {a.openCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <MailOpen className="h-3.5 w-3.5" />
                          {a.openCount} open{a.openCount === 1 ? "" : "s"}
                        </span>
                      )}
                      {a.bouncedAt && (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <AlertTriangle className="h-3.5 w-3.5" /> Bounced
                        </span>
                      )}
                      {a.unsubscribedAt && (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <MailX className="h-3.5 w-3.5" /> Unsubscribed
                        </span>
                      )}
                      {a.failReason && <span className="text-destructive">{a.failReason}</span>}
                    </div>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.startAt ? formatDateTime(a.startAt) : formatDateTime(a.createdAt)}
                      {a.location ? ` · ${a.location}` : ""}
                      {a.owner?.fullName ? ` · ${a.owner.fullName}` : ""}
                    </p>
                  )}

                  {a.description && (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm">{a.description}</p>
                  )}
                  {a.outcome && (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Outcome: </span>
                      {a.outcome}
                    </p>
                  )}
                </div>

                {canWrite && a.activityType !== "EMAIL" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(a.id, a.subject)}
                    disabled={pending}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${a.subject}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
