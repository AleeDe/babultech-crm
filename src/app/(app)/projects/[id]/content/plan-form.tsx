"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { CONTENT_CHANNELS, CONTENT_FORMATS, type ContentPlan } from "@/lib/content-planning";
import { pakistanInputToIso } from "@/lib/calling";
import { humanize } from "@/lib/utils";
import { saveContentPlan } from "@/server/content-planning";
export function ContentPlanForm({ tasks, initial }: { tasks: { id: string; name: string }[]; initial?: ContentPlan }) {
 const router = useRouter(); const [pending, start] = useTransition(); const [message, setMessage] = useState("");
 return <form className="grid gap-3 sm:grid-cols-2 mt-4" onSubmit={event => {
 event.preventDefault(); const data = new FormData(event.currentTarget); setMessage("");
 const plannedPublishAt = pakistanInputToIso(String(data.get("plannedPublishAt")));
 if (!plannedPublishAt) { setMessage("Choose a valid planned publication time."); return; }
 start(async () => { try {
 const result = await saveContentPlan({ taskId: initial?.taskId ?? data.get("taskId"), expectedRevision: initial?.revision ?? 0, plan: {
 channel: data.get("channel"), format: data.get("format"), objective: data.get("objective"), audience: data.get("audience"), brief: data.get("brief"), plannedPublishAt, clientApprovalRequired: data.get("clientApprovalRequired") === "on",
 } });
 if (!result.ok) { setMessage(result.error); return; }
 router.push(`?month=${String(data.get("plannedPublishAt")).slice(0, 7)}`); router.refresh(); setMessage("Plan saved. This is a planning date, not approval or publication.");
 } catch { setMessage("Save could not be confirmed. Refresh to check the plan before retrying."); } });
 }}>
 {!initial && <label className="sm:col-span-2">Existing project task<Select aria-label="Existing project task" name="taskId" required disabled={pending}><option value="">Choose an open task</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.name}</option>)}</Select></label>}
 <label>Channel<Select aria-label="Channel" name="channel" defaultValue={initial?.channel ?? "INSTAGRAM"} disabled={pending}>{CONTENT_CHANNELS.map(value => <option key={value} value={value}>{humanize(value)}</option>)}</Select></label>
 <label>Format<Select aria-label="Format" name="format" defaultValue={initial?.format ?? "POST"} disabled={pending}>{CONTENT_FORMATS.map(value => <option key={value} value={value}>{humanize(value)}</option>)}</Select></label>
 <label>Objective<Textarea name="objective" defaultValue={initial?.objective} maxLength={2000} required disabled={pending} /></label>
 <label>Audience<Textarea name="audience" defaultValue={initial?.audience} maxLength={2000} required disabled={pending} /></label>
 <label className="sm:col-span-2">Brief and brand/reference instructions<Textarea name="brief" defaultValue={initial?.brief} maxLength={8000} required disabled={pending} /></label>
 <label>Planned publish time (Pakistan time)<Input name="plannedPublishAt" type="datetime-local" required disabled={pending} defaultValue={initial ? new Date(new Date(initial.plannedPublishAt).getTime() + 5 * 3600000).toISOString().slice(0, 16) : undefined} /></label>
 <label className="flex items-center gap-2"><input name="clientApprovalRequired" type="checkbox" defaultChecked={initial?.clientApprovalRequired ?? true} disabled={pending} /> Client approval will be required</label>
 {message && <p role="status" className="text-sm sm:col-span-2">{message}</p>}
 <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save content plan"}</Button>
 </form>;
}
