"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { CALL_OUTCOMES, pakistanInputToIso } from "@/lib/calling";
import { humanize } from "@/lib/utils";
import { logLeadCall } from "@/server/calling";

export function CallForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  if (saved) return <p role="status">Call saved and next follow-up scheduled. View the call in Activities.</p>;
  return <details className="mt-4 border-t pt-3">
    <summary className="cursor-pointer font-medium">Log completed call</summary>
    <form className="mt-3 grid gap-3 sm:grid-cols-2" action={(form) => {
      const followUpAt = pakistanInputToIso(String(form.get("followUpAt") ?? ""));
      if (!followUpAt) { setError("Choose a valid follow-up date and time."); return; }
      requestId.current ??= crypto.randomUUID();
      setError("");
      startTransition(async () => {
        try {
          const result = await logLeadCall({ requestId: requestId.current, leadId,
            outcome: form.get("outcome"), notes: form.get("notes"), followUpAt });
          if (!result.ok) { setError(result.error); return; }
          setSaved(true); router.refresh();
        } catch { setError("Save could not be confirmed. Retry with the same details to avoid a duplicate call."); }
      });
    }}>
      <label>Outcome<Select name="outcome" disabled={pending} required>{CALL_OUTCOMES.map(value => <option key={value} value={value}>{humanize(value)}</option>)}</Select></label>
      <label>Next follow-up (Pakistan time)<Input name="followUpAt" type="datetime-local" disabled={pending} required /></label>
      <label className="sm:col-span-2">Call notes and next action<Textarea name="notes" maxLength={4000} disabled={pending} required /></label>
      <p className="text-sm text-muted-foreground sm:col-span-2">For a wrong number, schedule contact verification. Recording a call does not change the lead's status.</p>
      {error && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save call & follow-up"}</Button>
    </form>
  </details>;
}
