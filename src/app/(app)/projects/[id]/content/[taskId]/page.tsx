import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Button } from "@/components/ui";
import { getContentVersions } from "@/server/content-versions";
import { VersionActionForm } from "./version-forms";
import { ReviewLinkPanel } from "./review-link";
export default async function ContentVersionsPage({ params, searchParams }: { params: Promise<{ id: string; taskId: string }>; searchParams: Promise<{ page?: string }> }) {
 const { id, taskId } = await params; const query = await searchParams;
 const data = await getContentVersions(id, taskId, Number(query.page ?? 1)); if (!data) notFound();
 const dates = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" });
 return <>
 <PageHeader title="Content versions & approvals" description={data.task.name} backTo={`/projects/${id}/content`} backLabel="Content calendar" />
 <p className="text-sm my-4">Copy and asset references are saved as immutable versions. A new version or changed plan requires fresh approval. Internal notes are visible to authorized project staff.</p>
 {!data.plan && <p>Add a content plan from the calendar before creating versions.</p>}
 {data.plan && data.canWrite && !["COMPLETED", "CANCELLED"].includes(data.task.status) && <details className="rounded-xl border bg-card p-5 mb-5"><summary className="font-semibold cursor-pointer">Create version {data.latest + 1}</summary><p className="text-sm whitespace-pre-wrap mt-3">Current brief: {data.plan.brief}</p><VersionActionForm key={`${data.latest}-${data.plan.revision}`} kind="version" taskId={taskId} expected={data.latest} planRevision={data.plan.revision} /></details>}
 <p className="text-sm my-4">{data.count} versions · Page {data.page}. Times use Pakistan time.</p>
 <div className="space-y-5">{data.versions.map(v => {
 const current = v.versionNumber === data.latest && v.planRevision === data.plan?.revision;
 const internal = v.reviews.find(r => r.stage === "INTERNAL"); const client = v.reviews.find(r => r.stage === "CLIENT");
 const ready = current && internal?.decision === "APPROVED" && (!v.planSnapshot.clientApprovalRequired || client?.decision === "APPROVED");
 const reviewer = current && data.canReview && v.createdById !== data.userId && !["COMPLETED", "CANCELLED"].includes(data.task.status);
 return <article className="rounded-xl border bg-card p-5" key={v.id}>
 <h2 className="font-semibold">Version {v.versionNumber} · {current ? "Current plan/version" : "Historical or plan changed"}</h2>
 <p className="text-sm">{v.author?.fullName ?? "Project staff"} · {dates.format(new Date(v.createdAt))} PKT · Plan revision {v.planRevision}</p>
 <p className="whitespace-pre-wrap my-4">{v.copy}</p>
 {v.assetUrl && <div className="text-sm"><a href={v.assetUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open asset version</a><p className="break-all">SHA-256: {v.assetSha256}</p></div>}
 <details className="my-3"><summary className="cursor-pointer">Saved brief and approval requirement</summary><p className="whitespace-pre-wrap text-sm">{v.planSnapshot.brief}</p><p className="text-sm">Client approval: {v.planSnapshot.clientApprovalRequired ? "Required" : "Not required"}</p></details>
 <div className="space-y-3 my-4">{v.reviews.map(r => <div key={r.id} className="border-l-2 pl-3 text-sm"><p>{r.stage} · {r.decision} · {r.reviewer?.fullName ?? "Reviewer"} · {dates.format(new Date(r.createdAt))} PKT</p>{r.clientApprover && <p>Client approver: {r.clientApprover}{r.viaLinkId ? " (recorded by the client)" : " (recorded by staff)"}</p>}<p className="whitespace-pre-wrap">{r.evidence}</p></div>)}</div>
 {reviewer && !internal && <VersionActionForm kind="review" versionId={v.id} />}
 {internal?.decision === "APPROVED" && v.planSnapshot.clientApprovalRequired && !client && <ReviewLinkPanel versionId={v.id} links={data.links.get(v.id) ?? []} canSend={Boolean(current && data.canManage && !["COMPLETED", "CANCELLED"].includes(data.task.status))} />}
 {reviewer && data.canManage && internal?.decision === "APPROVED" && v.planSnapshot.clientApprovalRequired && !client && <VersionActionForm kind="review" versionId={v.id} stage="CLIENT" />}
 {(internal?.decision === "CHANGES_REQUESTED" || client?.decision === "CHANGES_REQUESTED") && <p className="text-sm">Changes requested. Submit a new version for another review.</p>}
 {v.publications.map(p => <p key={p.id} className="text-sm mt-3">Publication evidence: <a href={p.liveUrl} target="_blank" rel="noopener noreferrer" className="underline text-primary">Live URL</a> · {dates.format(new Date(p.publishedAt))} PKT</p>)}
 {ready && data.canWrite && data.task.status !== "CANCELLED" && !v.publications.length && <details className="mt-4"><summary className="cursor-pointer font-medium">Record publication evidence</summary><VersionActionForm kind="publication" versionId={v.id} /></details>}
 </article>;
 })}</div>
 {!data.versions.length && <p>No saved versions yet.</p>}
 <nav className="flex gap-3 mt-5" aria-label="Version pages">{data.page > 1 && <Button asChild variant="outline"><Link href={`?page=${data.page - 1}`}>Previous</Link></Button>}{data.page * 20 < data.count && <Button asChild variant="outline"><Link href={`?page=${data.page + 1}`}>Next</Link></Button>}</nav>
 </>;
}
