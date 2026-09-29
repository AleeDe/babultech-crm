"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from "@/components/ui";
import { saveSchedulerAddress, runJobsNow, type RunnerStatus } from "@/server/jobs";
import { asUtc } from "@/components/notification-bell";

/**
 * For administrators: the one thing the scheduler needs to know - the site's
 * public address - and whether it has been keeping up.
 */
export function SchedulerCard({ status }: { status: RunnerStatus }) {
  const router = useRouter();
  const [url, setUrl] = useState(status.publicAppUrl ?? status.suggestedUrl ?? "");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const last = status.lastRuns[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduler</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Every minute there is work waiting, Supabase calls this site to send notification emails and carry on
          with jobs. It needs the site&apos;s public address to do that.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status.publicAppUrl && (
          <Alert tone="warning">
            No address is set, so notification emails are not being sent. Jobs still start straight away from the
            screen that queued them.
          </Alert>
        )}
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px] flex-1">
            <Field label="Public address of this site" help="The https:// address people use to open the CRM.">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://crm.example.com" />
            </Field>
          </div>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMessage(null);
                const result = await saveSchedulerAddress(url);
                setMessage(result.ok ? { tone: "success", text: "Saved. The scheduler calls this address from its next visit." } : { tone: "danger", text: result.error });
                router.refresh();
              })
            }
          >
            Save address
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMessage(null);
                const result = await runJobsNow();
                setMessage(result.ok ? { tone: "success", text: `Ran now: ${result.data.processed} item${result.data.processed === 1 ? "" : "s"} handled.` } : { tone: "danger", text: result.error });
                router.refresh();
              })
            }
          >
            Run now
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {last
            ? `Last ran ${asUtc(last.startedAt).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}` +
              ` (${last.trigger.toLowerCase()}), ${last.processed} handled${last.error ? ` - error: ${last.error}` : ""}.`
            : "It has not run yet."}
        </p>
      </CardContent>
    </Card>
  );
}
