import Link from "next/link";
import { Button, PageHeader, Forbidden, Alert } from "@/components/ui";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getLeadQuality } from "@/server/lead-quality";
import { qualityLabels, type QualityIssue } from "@/lib/lead-quality";

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ issue?: string; page?: string }> }) {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.LEAD_READ)) return <Forbidden what="lead research" />;
  const params = await searchParams;
  const issue = Object.hasOwn(qualityLabels, params.issue ?? "") ? params.issue as QualityIssue : "all";
  const { rows, scanned, total, truncated } = await getLeadQuality();
  const flagged = rows.filter(row => issue === "all" ? row.issues.length > 0 : row.issues.includes(issue));
  const requestedPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, Math.max(1, Math.ceil(flagged.length / 40))) : 1;
  const byId = new Map(rows.map(row => [row.lead.id, row.lead]));
  return <>
    <PageHeader title="Research quality queue" description="Review gaps in the open leads you can access, then correct the original record."><Button asChild variant="outline"><Link href="/leads">Leads</Link></Button></PageHeader>
    <p className="text-sm text-muted-foreground my-4">Reviewed {scanned} of {total} visible open leads. Matches use email or phone formatting only, across these records. Shared contact details need human review; this is not a verification of contact ownership or deliverability.</p>
    {truncated && <Alert tone="warning">This scan is limited to 5,000 visible open leads. Counts and duplicate suggestions are partial; records outside the scan are not checked.</Alert>}
    <nav aria-label="Research quality filters" className="flex flex-wrap gap-2 my-5">{[["all", "All issues"], ...Object.entries(qualityLabels)].map(([key, label]) => <Button key={key} asChild variant={key === issue ? undefined : "outline"}><Link aria-current={key === issue ? "page" : undefined} href={`/leads/research?issue=${key}`}>{label} ({rows.filter(row => key === "all" ? row.issues.length : row.issues.includes(key as QualityIssue)).length})</Link></Button>)}</nav>
    <p className="text-sm mb-4">{flagged.length} matching leads · Page {page}</p>
    <div className="space-y-4">{flagged.slice((page - 1) * 40, page * 40).map(({ lead, issues, duplicateIds, duplicateCount }) => <article key={lead.id} className="border rounded-xl bg-card p-5">
      <Link className="font-semibold text-primary" href={`/leads/${lead.id}`}>{lead.firstName} {lead.lastName} · {lead.leadNumber}</Link>
      <p className="text-sm text-muted-foreground">{lead.companyName || "No company recorded"}</p>
      <ul className="list-disc pl-5 my-3 text-sm">{issues.map(key => <li key={key}>{qualityLabels[key]}{key === "brief" ? " — record the prospect's need or research context in Description." : key === "contact" ? " — check Email, Phone and WhatsApp in the lead record." : key === "source" ? " — record the known source, campaign or referral." : key === "followup" ? " — schedule the next action." : " — compare the records before deciding whether they represent the same person."}</li>)}</ul>
      {duplicateIds.length > 0 && <div className="text-sm mb-3">Matching records ({duplicateCount}): <div className="flex flex-wrap gap-3">{duplicateIds.slice(0, 10).map(id => <Link key={id} className="underline text-primary" href={`/leads/${id}`}>{byId.get(id)?.leadNumber}</Link>)}</div>{duplicateCount > 10 && <p>Showing the first 10 matches. Review shared company contact details.</p>}</div>}
      {can(user, PERMISSIONS.LEAD_WRITE) && <Button asChild variant="outline"><Link href={`/leads/${lead.id}/edit`}>Review and correct lead</Link></Button>}
    </article>)}</div>
    {!flagged.length && <p className="border rounded-xl p-6">No issues in this view within the scanned records. Use the calling queue for due or overdue follow-ups.</p>}
    <nav aria-label="Research queue pages" className="flex gap-3 mt-5">{page > 1 && <Button asChild variant="outline"><Link href={`/leads/research?issue=${issue}&page=${page - 1}`}>Previous</Link></Button>}{page * 40 < flagged.length && <Button asChild variant="outline"><Link href={`/leads/research?issue=${issue}&page=${page + 1}`}>Next</Link></Button>}</nav>
  </>;
}
