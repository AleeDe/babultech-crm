import Link from "next/link";
import { notFound } from "next/navigation";
import { getContentCalendar } from "@/server/content-planning";
import { PageHeader, Button } from "@/components/ui";
import { humanize } from "@/lib/utils";
import { ContentPlanForm } from "./plan-form";
export default async function ContentCalendarPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string; page?: string }> }) {
 const { id } = await params; const query = await searchParams;
 const data = await getContentCalendar(id, query.month, Number(query.page ?? 1)); if (!data) notFound();
 const dates = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Karachi" });
 return <>
 <PageHeader title="Content planning calendar" description={data.project.name} backTo={`/projects/${id}`} backLabel="Back to project" />
 <p className="text-sm text-muted-foreground my-4">A monthly agenda of planned content. Ownership, due dates and progress come from the existing project tasks. Plans are not approved assets or evidence of publication. Times use Pakistan time (PKT).</p>
 <nav className="flex flex-wrap items-center gap-3 my-4" aria-label="Calendar month"><Button asChild variant="outline"><Link href={`?month=${data.period.previous}`}>Previous month</Link></Button><form className="flex gap-2"><input aria-label="Month" type="month" name="month" min="2000-01" max="2100-12" defaultValue={data.period.month} className="border rounded px-3" /><Button type="submit" variant="outline">View month</Button></form><Button asChild variant="outline"><Link href={`?month=${data.period.next}`}>Next month</Link></Button></nav>
 {data.canManage && <details className="border rounded-xl bg-card p-5 mb-5"><summary className="font-semibold cursor-pointer">Plan an existing content task</summary><p className="text-sm mt-3">Create and assign tasks in the project workspace first. To change an existing plan, open its month and use Edit plan.</p>{data.taskCount > 500 && <p className="text-sm">Showing the first 500 open tasks by name.</p>}<ContentPlanForm tasks={data.tasks} /></details>}
 <p className="text-sm my-4">{data.count} content plans · {data.period.month} · Page {data.page}</p>
 <div className="space-y-4">{data.rows.map(plan => <article key={plan.taskId} className="border rounded-xl bg-card p-5">
 <p className="text-sm font-medium">{dates.format(new Date(plan.plannedPublishAt))} PKT</p>
 <h2 className="font-semibold mt-2"><Link className="text-primary underline" href={`/projects/${id}/tasks/${plan.taskId}`}>{plan.task.name}</Link></h2>
 <p className="text-sm">{humanize(plan.channel)} · {humanize(plan.format)} · Task: {humanize(plan.task.status)}</p>
 <p className="text-sm">Owner: {plan.task.owner?.fullName ?? "Unassigned"}</p>
 <Link className="text-sm text-primary underline" href={`/projects/${id}/content/${plan.taskId}`}>Versions, approvals & publication</Link>
 <p className="text-sm">Task due: {plan.task.dueDate?.slice(0, 10) ?? "Not set"} · Client approval requirement: {plan.clientApprovalRequired ? "Required" : "Not required"}</p>
 <dl className="grid gap-3 mt-4 sm:grid-cols-2"><div><dt className="font-medium">Objective</dt><dd className="whitespace-pre-wrap text-sm">{plan.objective}</dd></div><div><dt className="font-medium">Audience</dt><dd className="whitespace-pre-wrap text-sm">{plan.audience}</dd></div><div className="sm:col-span-2"><dt className="font-medium">Brief</dt><dd className="whitespace-pre-wrap text-sm">{plan.brief}</dd></div></dl>
 {data.canManage && !["COMPLETED", "CANCELLED"].includes(plan.task.status) && <details className="mt-4 border-t pt-3"><summary className="cursor-pointer">Edit plan</summary><ContentPlanForm key={plan.revision} tasks={[]} initial={plan} /></details>}
 </article>)}</div>
 {!data.rows.length && <p className="rounded-xl border p-6">No planned content in this month.</p>}
 <nav className="flex gap-3 mt-4" aria-label="Content plan pages">{data.page > 1 && <Button asChild variant="outline"><Link href={`?month=${data.period.month}&page=${data.page - 1}`}>Previous page</Link></Button>}{data.page * 40 < data.count && <Button asChild variant="outline"><Link href={`?month=${data.period.month}&page=${data.page + 1}`}>Next page</Link></Button>}</nav>
 </>;
}
