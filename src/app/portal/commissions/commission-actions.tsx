"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestCommissionPercent, markCommissionPaid } from "@/server/portal";
import { Button, Field, Input, Textarea, Alert } from "@/components/ui";

/**
 * What a partner can do with their own commission: ask for a different rate
 * on this deal, and say they have been paid.
 *
 * Asking changes nothing until BabulTech approves it, and the form says so.
 */
export function PortalCommissionActions({
  id,
  currentPercent,
  canRequest,
  canMarkPaid,
}: {
  id: string;
  currentPercent: string;
  canRequest: boolean;
  canMarkPaid: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRequest && !canMarkPaid) return null;

  function markPaid() {
    if (!window.confirm("Mark this commission as paid? Do this once the money has reached you. It cannot be changed afterwards.")) return;
    setError(null);
    start(async () => {
      const result = await markCommissionPaid(id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function ask(formData: FormData) {
    setError(null);
    start(async () => {
      const result = await requestCommissionPercent({
        id,
        percent: Number(formData.get("percent")),
        reason: String(formData.get("reason") ?? ""),
      });
      if (result.ok) {
        setAsking(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {!asking && (
        <div className="flex flex-wrap gap-2">
          {canRequest && (
            <Button size="sm" variant="outline" onClick={() => setAsking(true)} disabled={pending}>
              Ask for a different rate
            </Button>
          )}
          {canMarkPaid && (
            <Button size="sm" onClick={markPaid} disabled={pending}>
              I have been paid
            </Button>
          )}
        </div>
      )}
      {asking && (
        <form action={ask} className="space-y-3 rounded-md border p-3">
          <p className="text-sm text-muted-foreground">
            Your rate on this deal stays at {Number(currentPercent)}% until BabulTech approves the new one.
          </p>
          <Field label="Rate you are asking for (%)">
            <Input id={`request-percent-${id}`} name="percent" type="number" step="0.01" min="0" max="100" required />
          </Field>
          <Field label="Why">
            <Textarea
              id={`request-reason-${id}`}
              name="reason"
              rows={3}
              required
              placeholder="What makes this deal different - the work involved, the size, what was agreed."
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Sending…" : "Send request"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setAsking(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
