import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { Button, PageHeader, Forbidden } from "@/components/ui";
import { getHandoffs } from "@/server/lead-handoffs";
import { qualificationLabels } from "@/lib/lead-handoffs";
import { HandoffDecisionForm } from "./forms";

export default async function HandoffsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.LEAD_READ)) return <Forbidden what="sales handoffs" />;
  const { handoffs, count, page } = await getHandoffs(Number((await searchParams).page ?? 1));
  const dates = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" });
  return <>
    <PageHeader title="Sales handoffs" description="Handoffs you sent or received. Accepting transfers lead ownership; returning it keeps the existing owner."><Button asChild variant="outline"><Link href="/leads">Leads</Link></Button></PageHeader>
    <p className="my-4 text-sm">{count} handoffs · Page {page}</p>
    <div className="space-y-5">{handoffs.map(h => <article key={h.id} className="rounded-xl border bg-card p-5">
      <h2 className="font-semibold">{h.leadLabel}</h2>
      <p className="text-sm">{h.senderName} → {h.recipientName} · {h.status}</p>
      <p className="text-sm text-muted-foreground">Submitted {dates.format(new Date(h.createdAt))} PKT · Proposed next action {dates.format(new Date(h.followUpAt))} PKT</p>
      <dl className="grid gap-3 my-4 sm:grid-cols-2">{Object.entries(qualificationLabels).map(([key, label]) => <div key={key}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap text-sm">{h.qualification[key as keyof typeof qualificationLabels]}</dd></div>)}</dl>
      {h.reason && <p className="whitespace-pre-wrap text-sm">Decision: {h.reason}{h.decidedAt && ` · ${dates.format(new Date(h.decidedAt))} PKT`}</p>}
      {h.acceptedFollowUpAt && <p className="text-sm">Accepted next action: {dates.format(new Date(h.acceptedFollowUpAt))} PKT</p>}
      {h.status === "ACCEPTED" && h.recipientId === user.id && <Link className="text-primary underline" href={`/leads/${h.leadId}`}>Open lead and continue to conversion</Link>}
      {h.status === "PENDING" && can(user, PERMISSIONS.LEAD_WRITE) && (h.senderId === user.id || can(user, PERMISSIONS.OPPORTUNITY_WRITE)) && <HandoffDecisionForm id={h.id} sender={h.senderId === user.id} />}
    </article>)}</div>
    {!handoffs.length && <p>No handoffs yet. Open an assigned lead to qualify it and submit a sales handoff.</p>}
    <nav className="mt-5 flex gap-3" aria-label="Handoff pages">{page > 1 && <Button asChild variant="outline"><Link href={`/leads/handoffs?page=${page - 1}`}>Previous</Link></Button>}{page * 40 < count && <Button asChild variant="outline"><Link href={`/leads/handoffs?page=${page + 1}`}>Next</Link></Button>}</nav>
  </>;
}
