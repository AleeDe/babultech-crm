"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { qualificationLabels } from "@/lib/lead-handoffs";
import { pakistanInputToIso } from "@/lib/calling";
import { requestHandoff, decideHandoff } from "@/server/lead-handoffs";

export function RequestHandoffForm({ leadId, recipients }: { leadId: string; recipients: { id: string; fullName: string }[] }) {
  const router = useRouter(); const id = useRef<string | null>(null);
  const [pending, start] = useTransition(); const [message, setMessage] = useState(""); const [saved, setSaved] = useState(false);
  if (saved) return <p role="status">Handoff submitted. Ownership stays with you until acceptance.</p>;
  if (!recipients.length) return <p>No other active staff have the required lead and sales permissions. An administrator must configure the receiving salesperson's access.</p>;
  return <form className="grid gap-4 sm:grid-cols-2" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const followUpAt = pakistanInputToIso(String(form.get("followUpAt")));
    if (!followUpAt) { setMessage("Choose a valid next-action date."); return; }
    id.current ??= crypto.randomUUID(); setMessage("");
    start(async () => { try {
      const result = await requestHandoff({ id: id.current, leadId, recipientId: form.get("recipientId"), followUpAt, qualification: Object.fromEntries(Object.keys(qualificationLabels).map(key => [key, form.get(key)])) });
      if (!result.ok) { setMessage(result.error); return; }
      setSaved(true); router.refresh();
    } catch { setMessage("Save could not be confirmed. Retry with the same details."); } });
  }}>
    <p className="text-sm text-muted-foreground sm:col-span-2">Record the discovery context. For authority, budget or timing that is not known yet, enter Unknown and explain what needs checking. Submission marks the lead Qualified; ownership transfers only on acceptance.</p>
    {Object.entries(qualificationLabels).map(([key, label]) => <label key={key}>{label}<Textarea name={key} required maxLength={2000} disabled={pending} /></label>)}
    <label>Receiving salesperson<Select name="recipientId" required disabled={pending}><option value="">Choose salesperson</option>{recipients.map(person => <option key={person.id} value={person.id}>{person.fullName}</option>)}</Select></label>
    <label>Next action (Pakistan time)<Input name="followUpAt" type="datetime-local" required disabled={pending} /></label>
    {message && <p role="alert" className="sm:col-span-2 text-red-600">{message}</p>}
    <Button disabled={pending} type="submit">{pending ? "Submitting…" : "Submit sales handoff"}</Button>
  </form>;
}
export function HandoffDecisionForm({ id, sender }: { id: string; sender: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [message, setMessage] = useState("");
  const [decision, setDecision] = useState(sender ? "CANCELLED" : "ACCEPTED");
  return <form className="grid gap-3 mt-4 sm:grid-cols-2" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setMessage("");
    start(async () => { try {
      const result = await decideHandoff({ id, decision, reason: form.get("reason"), followUpAt: decision === "ACCEPTED" ? pakistanInputToIso(String(form.get("followUpAt"))) : null });
      if (!result.ok) { setMessage(result.error); return; }
      router.refresh();
    } catch { setMessage("Decision could not be confirmed. Refresh or retry."); } });
  }}>
    <label>Decision<Select value={decision} onChange={event => setDecision(event.target.value)} disabled={pending}>{sender ? <option value="CANCELLED">Cancel handoff</option> : <><option value="ACCEPTED">Accept ownership</option><option value="REJECTED">Return to sender</option></>}</Select></label>
    {decision === "ACCEPTED" && <label>Next action (Pakistan time)<Input name="followUpAt" type="datetime-local" required disabled={pending} /></label>}
    <label className="sm:col-span-2">Reason / next-action notes<Textarea name="reason" required maxLength={2000} disabled={pending} /></label>
    {message && <p role="alert" className="text-red-600 sm:col-span-2">{message}</p>}
    <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record decision"}</Button>
  </form>;
}
