import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Button, Forbidden } from "@/components/ui";
import { getDeliveryHandoffs, getDeliveryOptions } from "@/server/delivery-handoffs";
import { deliveryFields } from "@/lib/delivery-handoffs";
import { DeliverySubmitForm, DeliveryDecisionForm } from "./forms";
export default async function DeliveryHandoffsPage({ searchParams }: { searchParams: Promise<{ opportunityId?: string; page?: string }> }) {
 const user = await requireUser();
 if (!can(user, PERMISSIONS.OPPORTUNITY_READ) && !can(user, PERMISSIONS.PROJECT_MANAGE)) return <Forbidden what="delivery handoffs" />;
 const params = await searchParams;
 const options = params.opportunityId && can(user, PERMISSIONS.OPPORTUNITY_WRITE) ? await getDeliveryOptions(params.opportunityId) : null;
 const { rows, count, page } = await getDeliveryHandoffs(Number(params.page ?? 1));
 const dates = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" });
 return <>
 <PageHeader title="Delivery handoffs" description="Sales submits the delivery brief; the assigned PM reviews scope, capacity and kickoff readiness."><Button asChild variant="outline"><Link href="/projects">Projects</Link></Button></PageHeader>
 {options && <section className="my-5 rounded-xl border bg-card p-5"><h2 className="font-semibold mb-4">New delivery handoff</h2><DeliverySubmitForm options={options} /></section>}
 <p className="my-4 text-sm">{count} handoffs · Page {page}. To submit, open a won opportunity you own and select Delivery handoff.</p>
 <div className="space-y-5">{rows.map(h => <article key={h.id} className="rounded-xl border bg-card p-5">
 <h2 className="font-semibold">{h.projectName} · {h.status}</h2><p>{h.senderName} → {h.recipientName}</p>
 <p className="text-sm">{h.quoteSnapshot.number} · Version {h.quoteSnapshot.version} · {h.quoteSnapshot.amount} {h.quoteSnapshot.currency} · Payment prerequisite: {h.paymentState}</p>
 <details className="my-3"><summary className="cursor-pointer font-medium">Delivery checklist</summary><dl className="grid gap-4 mt-4 sm:grid-cols-2">{Object.entries(deliveryFields).map(([key, label]) => <div key={key}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap text-sm">{h.checklist[key as keyof typeof deliveryFields]}</dd></div>)}</dl></details>
 {h.reason && <p className="whitespace-pre-wrap text-sm">Review: {h.reason}</p>}{h.kickoffAt && <p className="text-sm">Agreed kickoff: {dates.format(new Date(h.kickoffAt))} PKT. Project activation is a separate action.</p>}
 {h.recipientId === user.id && can(user, PERMISSIONS.PROJECT_READ) && <Link className="underline text-primary" href={`/projects/${h.projectId}`}>Open project</Link>}
 {h.status === "PENDING" && ((h.senderId === user.id && can(user, PERMISSIONS.OPPORTUNITY_WRITE)) || (h.recipientId === user.id && can(user, PERMISSIONS.PROJECT_MANAGE))) && <DeliveryDecisionForm id={h.id} sender={h.senderId === user.id && can(user, PERMISSIONS.OPPORTUNITY_WRITE)} recipient={h.recipientId === user.id && can(user, PERMISSIONS.PROJECT_MANAGE)} paymentPending={h.paymentState === "PENDING"} />}
 </article>)}</div>
 {!rows.length && <p>No delivery handoffs to review yet.</p>}
 <nav className="flex gap-3 mt-5" aria-label="Handoff pages">{page > 1 && <Button asChild variant="outline"><Link href={`/projects/handoffs?page=${page - 1}`}>Previous</Link></Button>}{page * 40 < count && <Button asChild variant="outline"><Link href={`/projects/handoffs?page=${page + 1}`}>Next</Link></Button>}</nav>
 </>;
}
