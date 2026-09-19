import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { CAPACITY_WEEKS, type CapacityWeeks } from "@/lib/capacity";
import { getCapacityForecast } from "@/server/capacity";
import { PageHeader, Card, CardContent, StatTile, Select, Button, Forbidden } from "@/components/ui";

export default async function CapacityPage({ searchParams }: { searchParams: Promise<{ weeks?: string }> }) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.PROJECT_MANAGE) || !can(me, PERMISSIONS.PROJECT_READ)) return <Forbidden what="capacity planning" />;
  const query = await searchParams;
  const requested = Number(query.weeks) as CapacityWeeks;
  const data = await getCapacityForecast(CAPACITY_WEEKS.includes(requested) ? requested : 4);
  return <>
    <PageHeader title="Capacity planning" description="Review remaining task estimates before committing delivery dates.">
      <form className="flex flex-wrap items-center gap-2">
        <Select name="weeks" aria-label="Forecast period" defaultValue={String(data.weeks)}>
          {CAPACITY_WEEKS.map(w => <option key={w} value={w}>{w} week{w === 1 ? "" : "s"}</option>)}
        </Select>
        <Button type="submit">Apply</Button>
      </form>
    </PageHeader>
    <p className="mb-4 text-sm text-muted-foreground">{data.window.from} to {data.window.to} · Pakistan time. Assumes 8 hours per weekday; leave, holidays and project allocations are not deducted. Remaining estimates are spread over remaining task weekdays; overdue work is carried into today.</p>
    <p className="mb-4 text-sm text-muted-foreground">Only projects visible to you are included ({data.scannedTasks} tasks scanned). Low recorded load does not confirm availability; other projects and work without estimates or dates may be missing.</p>
    {data.truncated && <p role="alert" className="mb-4 rounded border border-amber-500 p-3">Incomplete forecast: the scan limit was reached. Do not use these totals to confirm availability.</p>}
    <div className="grid gap-4 sm:grid-cols-3">
      <StatTile label="Overloaded people" value={String(data.totals.overloaded)} />
      <StatTile label="Tasks without estimates" value={String(data.totals.unestimated)} />
      <StatTile label="Tasks without due dates" value={String(data.totals.undated)} />
    </div>
    <div className="mt-6 space-y-4">
      {data.rows.length === 0 && <p>No people are visible for this forecast.</p>}
      {data.rows.map(row => <Card key={row.userId}><CardContent className="p-4">
        <div className="flex flex-wrap justify-between gap-2">
          <h2 className="font-semibold">{row.fullName}</h2>
          <p className={row.overloaded ? "font-semibold text-red-600" : "text-muted-foreground"}>{row.plannedHours}h planned / {row.availableHours}h weekday capacity · {row.overloaded ? "Overloaded" : row.loadPercent == null ? "No weekday capacity" : `${row.loadPercent}% recorded load`}</p>
        </div>
        {(row.unestimatedTasks > 0 || row.undatedTasks > 0) && <p className="mt-2 text-sm text-amber-700">{row.unestimatedTasks} without estimates · {row.undatedTasks} without due dates</p>}
        {row.overloadedDays.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer text-red-600">Overloaded days ({row.overloadedDays.length})</summary><ul className="mt-2 space-y-1">{row.overloadedDays.map(day => <li key={day.date}>{day.date}: {day.plannedHours}h planned / {day.availableHours}h capacity</li>)}</ul></details>}
        <details className="mt-3 text-sm"><summary className="cursor-pointer">Contributing tasks ({row.tasks.length})</summary>
          <ul className="mt-2 space-y-2">{row.tasks.map(task => <li key={task.id} className="flex flex-wrap justify-between gap-2"><Link className="min-w-0 break-words hover:underline" href={`/projects/${task.projectId}`}>{task.projectName}: {task.name}</Link><span>{task.hours}h · due {task.dueDate}</span></li>)}</ul>
        </details>
      </CardContent></Card>)}
    </div>
  </>;
}
