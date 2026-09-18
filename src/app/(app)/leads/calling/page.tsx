import Link from "next/link";
import { Button, PageHeader, Forbidden } from "@/components/ui";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { CALL_QUEUE_FILTERS, callQueueBucket, type CallQueueFilter } from "@/lib/calling";
import { humanize } from "@/lib/utils";
import { getCallingQueue } from "@/server/calling";
import { CallForm } from "./call-form";

const labels: Record<CallQueueFilter, string> = { due: "Due & overdue", today: "Later today", unscheduled: "Needs scheduling", upcoming: "Upcoming", all: "All open" };
export default async function CallingPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.LEAD_READ)) return <Forbidden what="leads" />;
  const params = await searchParams;
  const filter = CALL_QUEUE_FILTERS.includes(params.filter as CallQueueFilter) ? params.filter as CallQueueFilter : "due";
  const { leads, count, page, now } = await getCallingQueue(filter, Number(params.page ?? 1));
  const dates = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" });
  return <>
    <PageHeader title="My calling queue" description="Your assigned open leads. Follow-up times use Pakistan time (PKT)."><Button asChild variant="outline"><Link href="/leads">All leads</Link></Button></PageHeader>
    <nav aria-label="Calling queue filters" className="flex flex-wrap gap-2 my-5">{CALL_QUEUE_FILTERS.map(value => <Button key={value} asChild variant={value === filter ? undefined : "outline"}><Link aria-current={value === filter ? "page" : undefined} href={`/leads/calling?filter=${value}`}>{labels[value]}</Link></Button>)}</nav>
    <p className="mb-4 text-sm text-muted-foreground">{count} matching leads · Page {page}</p>
    <div className="space-y-4">{leads.map(lead => <article key={lead.id} className="rounded-xl border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><Link className="font-semibold text-primary" href={`/leads/${lead.id}`}>{lead.firstName} {lead.lastName}</Link><p className="text-sm text-muted-foreground">{lead.companyName || "No company"} · {lead.leadNumber}</p></div><span className="text-sm">{humanize(lead.status)} · {labels[callQueueBucket(lead.nextFollowUpAt, new Date(now))]}</span></div>
      <p className="mt-3">{lead.phone || "No phone number — add contact details before calling."}</p>
      <p className="text-sm text-muted-foreground">Follow-up: {lead.nextFollowUpAt ? `${dates.format(new Date(lead.nextFollowUpAt))} PKT` : "Not scheduled"}</p>
      {can(user, PERMISSIONS.LEAD_WRITE) && <CallForm leadId={lead.id} />}
    </article>)}</div>
    {!leads.length && <p className="rounded-xl border p-6">No leads in this view. Try Needs scheduling or All open. Only leads assigned to you appear here.</p>}
    <nav aria-label="Calling queue pages" className="flex gap-3 mt-5">{page > 1 && <Button asChild variant="outline"><Link href={`/leads/calling?filter=${filter}&page=${page - 1}`}>Previous</Link></Button>}{page * 40 < count && <Button asChild variant="outline"><Link href={`/leads/calling?filter=${filter}&page=${page + 1}`}>Next</Link></Button>}</nav>
  </>;
}
