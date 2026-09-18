"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Select, Textarea } from "@/components/ui";
import { monthLabel } from "@/lib/recurring-billing";
import { closePeriod, reopenPeriod } from "@/server/recurring-billing";

export function PeriodForms({ closable, closed }: { closable: string[]; closed: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function submit(action: typeof closePeriod, form: FormData, done: string) {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await action({
        periodStart: String(form.get("periodStart") ?? ""),
        note: String(form.get("note") ?? ""),
      });
      if (result.ok) {
        setNotice(done);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <div className="my-5 grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Close a month</CardTitle></CardHeader>
        <CardContent>
          {error && <div className="mb-3"><Alert tone="danger">{error}</Alert></div>}
          {notice && <div className="mb-3"><Alert tone="success">{notice}</Alert></div>}

          {closable.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing to close. A month can only be closed once it has finished, and only if it has
              not been closed already.
            </p>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                submit(closePeriod, new FormData(event.currentTarget), "Month closed.");
              }}
            >
              <label className="block text-sm">
                Month
                <Select name="periodStart" required disabled={pending}>
                  {closable.map((month) => (
                    <option key={month} value={month}>{monthLabel(month)}</option>
                  ))}
                </Select>
              </label>
              <label className="block text-sm">
                Why this month is being closed
                <Textarea name="note" required maxLength={2000} disabled={pending} />
              </label>
              <p className="text-sm text-muted-foreground">
                After this, the month&apos;s invoices, payments and expenses can no longer be edited,
                and nothing new can be dated into it.
              </p>
              <Button type="submit" disabled={pending}>
                {pending ? "Working…" : "Close month"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Reopen a month</CardTitle></CardHeader>
        <CardContent>
          {closed.length === 0 ? (
            <p className="text-sm text-muted-foreground">No month is closed.</p>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                submit(reopenPeriod, new FormData(event.currentTarget), "Month reopened.");
              }}
            >
              <label className="block text-sm">
                Month
                <Select name="periodStart" required disabled={pending}>
                  {closed.map((month) => (
                    <option key={month} value={month}>{monthLabel(month)}</option>
                  ))}
                </Select>
              </label>
              <label className="block text-sm">
                Why it needs to be reopened
                <Textarea name="note" required maxLength={2000} disabled={pending} />
              </label>
              <p className="text-sm text-muted-foreground">
                Reopening is recorded against the month, so a period that was closed and opened again
                is visible rather than silent.
              </p>
              <Button type="submit" variant="outline" disabled={pending}>
                {pending ? "Working…" : "Reopen month"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
