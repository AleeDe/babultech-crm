"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Select, Textarea, Input } from "@/components/ui";
import { deliveryFields, type DeliveryOptions } from "@/lib/delivery-handoffs";
import { pakistanInputToIso } from "@/lib/calling";
import { submitDeliveryHandoff, decideDeliveryHandoff } from "@/server/delivery-handoffs";

export function DeliverySubmitForm({ options }: { options: DeliveryOptions }) {
 const router = useRouter(); const id = useRef<string | null>(null);
 const [pending, start] = useTransition(); const [error, setError] = useState(""); const [saved, setSaved] = useState(false);
 if (saved) return <p role="status">Submitted to the assigned PM. Review the handoff below.</p>;
 if (!options.projects.length || !options.quotes.length) return <p>A linked draft/planning customer project with an active PM and an accepted quotation are required. Have the PM create the project with this won opportunity and the same account, then return here.</p>;
 return <form className="grid gap-4 sm:grid-cols-2" onSubmit={event => {
 event.preventDefault(); const form = new FormData(event.currentTarget); id.current ??= crypto.randomUUID(); setError("");
 start(async () => { try {
 const result = await submitDeliveryHandoff({ id: id.current, projectId: form.get("projectId"), quotationId: form.get("quotationId"), paymentState: form.get("paymentState"), checklist: Object.fromEntries(Object.keys(deliveryFields).map(key => [key, form.get(key)])) });
 if (!result.ok) { setError(result.error); return; } setSaved(true); router.refresh();
 } catch { setError("Save could not be confirmed. Retry with the same details."); } });
 }}>
 <label>Planning project / PM<Select name="projectId" required disabled={pending}>{options.projects.map(p => <option key={p.id} value={p.id}>{p.name} — {p.manager}</option>)}</Select></label>
 <label>Accepted quotation<Select name="quotationId" required disabled={pending}>{options.quotes.map(q => <option key={q.id} value={q.id}>{q.number} · Version {q.version}</option>)}</Select></label>
 {Object.entries(deliveryFields).map(([key, label]) => <label key={key}>{label}<Textarea name={key} required maxLength={4000} disabled={pending} /></label>)}
 <label>Payment prerequisite<Select name="paymentState" disabled={pending}><option value="PENDING">Pending verification — blocks acceptance</option><option value="VERIFIED">Verified — evidence recorded above</option><option value="NOT_REQUIRED">Not required — reason recorded above</option></Select></label>
 <p className="text-sm text-muted-foreground">Record agreed commercial terms and evidence. This checklist does not collect money or verify the payment ledger automatically.</p>
 {error && <p role="alert" className="text-red-600 sm:col-span-2">{error}</p>}<Button type="submit" disabled={pending}>{pending ? "Submitting…" : "Submit to project manager"}</Button>
 </form>;
}
export function DeliveryDecisionForm({ id, sender, recipient, paymentPending }: { id: string; sender: boolean; recipient: boolean; paymentPending: boolean }) {
 const router = useRouter(); const [pending, start] = useTransition(); const [error, setError] = useState("");
 const [decision, setDecision] = useState(recipient ? "RETURNED" : "CANCELLED");
 return <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={event => {
 event.preventDefault(); const form = new FormData(event.currentTarget); setError("");
 start(async () => { try {
 const result = await decideDeliveryHandoff({ id, decision, reason: form.get("reason"), kickoffAt: decision === "ACCEPTED" ? pakistanInputToIso(String(form.get("kickoffAt"))) : null });
 if (!result.ok) { setError(result.error); return; } router.refresh();
 } catch { setError("Decision could not be confirmed. Refresh or retry."); } });
 }}>
 <label>Decision<Select value={decision} onChange={e => setDecision(e.target.value)} disabled={pending}>{recipient && <><option value="RETURNED">Return for corrections</option><option value="ACCEPTED" disabled={paymentPending}>Accept delivery readiness</option></>}{sender && <option value="CANCELLED">Cancel submission</option>}</Select></label>
 {decision === "ACCEPTED" && <label>Kickoff (Pakistan time)<Input type="datetime-local" name="kickoffAt" required disabled={pending} /></label>}
 <label className="sm:col-span-2">Review reason / capacity and readiness notes<Textarea name="reason" required maxLength={4000} disabled={pending} /></label>
 {paymentPending && <p className="text-sm sm:col-span-2">Payment verification is pending. Return this submission so sales can correct and resubmit it.</p>}
 {error && <p role="alert" className="text-red-600 sm:col-span-2">{error}</p>}<Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record review"}</Button>
 </form>;
}
