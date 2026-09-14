import Link from "next/link";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, Badge, statusTone,
  StatTile, Table, THead, TBody, TR, TH, TD, EmptyState, DetailRow,
} from "@/components/ui";
import { formatDate, formatNumber, formatMoney, humanize } from "@/lib/utils";
import type { getUserWorkload } from "@/server/users";

type Workload = Awaited<ReturnType<typeof getUserWorkload>>;

/**
 * The delivery half of a person's record.
 *
 * The rest of the user page is about the account — what the role permits, who
 * they report to, when they last signed in. This is about the work: where the
 * hours went, what is open, what got finished, and whether it landed on time.
 *
 * Separated into its own file because the page was already long, and because
 * these panels read from one server call that the access-control half does not
 * need.
 */

/** Hours today, this week, this month and all time. */
export function TimePanel({ time, utilisation }: Pick<Workload, "time" | "utilisation">) {
  const periods = [
    { label: "Today", d: time.today, note: "since midnight" },
    { label: "This week", d: time.week, note: `from ${formatDate(time.weekStartDay)}` },
    { label: "This month", d: time.month, note: `from ${formatDate(time.monthStartDay)}` },
    { label: "All time", d: time.total, note: `${time.total.entries} entries` },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time logged</CardTitle>
        <CardDescription>
          Billable hours in bold, with everything logged beside them. Rejected
          entries are excluded — that is time the business decided not to count.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {periods.map((p) => (
            <div key={p.label} className="rounded-lg border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {p.label}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular">
                {formatNumber(p.d.logged, 1)}
                <span className="text-sm font-normal text-muted-foreground">h</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {formatNumber(p.d.billable, 1)}h billable
                {p.d.logged.greaterThan(0) && ` · ${formatNumber(p.d.billableRatioPercent, 0)}%`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{p.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <DetailRow
            label="Utilisation this week"
            help="Logged hours against a 40-hour week."
          >
            <span className="tabular">{formatNumber(utilisation.weekPercent, 0)}%</span>
            <span className="text-xs text-muted-foreground">
              {" "}({formatNumber(utilisation.weekBillablePercent, 0)}% billable)
            </span>
          </DetailRow>
          <DetailRow
            label="Utilisation this month"
            help="Against an 8-hour day for the working days elapsed so far, so early in a month the figure is not built on days that have not happened yet."
          >
            <span className="tabular">{formatNumber(utilisation.monthPercent, 0)}%</span>
            <span className="text-xs text-muted-foreground">
              {" "}over {utilisation.monthWorkingDaysElapsed} working day
              {utilisation.monthWorkingDaysElapsed === 1 ? "" : "s"}
            </span>
          </DetailRow>
          <DetailRow
            label="Last entry"
            help="How current their timesheet is. Time logged long after the fact is usually reconstructed rather than remembered."
          >
            {time.lastEntryDay ? (
              <>
                <span>{formatDate(time.lastEntryDay)}</span>
                {time.daysSinceLastEntry !== null && time.daysSinceLastEntry > 0 && (
                  <span
                    className={
                      time.daysSinceLastEntry > 7
                        ? "text-xs font-medium text-amber-600 dark:text-amber-400"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {" "}
                    ({time.daysSinceLastEntry} day{time.daysSinceLastEntry === 1 ? "" : "s"} ago)
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">Never logged time</span>
            )}
          </DetailRow>
        </div>
      </CardContent>
    </Card>
  );
}

/** Thirty days of daily hours, so the shape of someone's work is visible. */
export function DailyTrend({ daily }: Pick<Workload, "daily">) {
  const peak = Math.max(8, ...daily.map((d) => d.hours));
  const logged = daily.filter((d) => d.hours > 0).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Last 30 days</CardTitle>
        <CardDescription>
          Billable in solid, non-billable stacked above. The gaps matter as much
          as the bars — {logged} of the last 30 days have time against them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {logged === 0 ? (
          <EmptyState title="No time logged in the last 30 days" />
        ) : (
          <>
            <div className="flex h-32 items-end gap-0.5">
              {daily.map((d) => {
                const nonBillable = Math.max(0, d.hours - d.billableHours);
                const weekend = [0, 6].includes(new Date(`${d.day}T00:00:00Z`).getUTCDay());
                return (
                  <div
                    key={d.day}
                    className="group relative flex flex-1 flex-col justify-end"
                    title={`${formatDate(d.day)} — ${formatNumber(d.hours, 1)}h logged, ${formatNumber(d.billableHours, 1)}h billable`}
                  >
                    <div
                      className="w-full rounded-t-sm bg-muted-foreground/25"
                      style={{ height: `${(nonBillable / peak) * 100}%` }}
                    />
                    <div
                      className={weekend ? "w-full bg-amber-500" : "w-full bg-emerald-500"}
                      style={{ height: `${(d.billableHours / peak) * 100}%` }}
                    />
                    {/* A day with nothing at all still needs a footprint, or the
                        bar chart silently loses its own x-axis. */}
                    {d.hours === 0 && <div className="h-px w-full bg-border" />}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{formatDate(daily[0]?.day)}</span>
              <span>Amber bars are weekend work</span>
              <span>{formatDate(daily[daily.length - 1]?.day)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Open, done, overdue, blocked — and how far through the open work is. */
export function TaskPanel({ tasks, estimates }: Pick<Workload, "tasks" | "estimates">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
        <CardDescription>
          What they hold now, what they have finished, and how much of the open
          work is already behind its date.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Open", value: tasks.open, tone: "" },
            {
              label: "Overdue",
              value: tasks.overdue,
              tone: tasks.overdue > 0 ? "text-red-600 dark:text-red-400" : "",
            },
            {
              label: "Blocked",
              value: tasks.blocked,
              tone: tasks.blocked > 0 ? "text-amber-600 dark:text-amber-400" : "",
            },
            { label: "Due this week", value: tasks.dueThisWeek, tone: "" },
            {
              label: "Completed",
              value: tasks.completed,
              tone: "text-emerald-600 dark:text-emerald-400",
            },
            { label: "Total ever", value: tasks.total, tone: "" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
              <p className={`mt-1 text-xl font-semibold tabular ${s.tone}`}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <DetailRow
            label="Average progress"
            help="Mean completion across their open tasks — how far through the work they are holding is."
          >
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(tasks.avgProgressPercent, 100)}%` }}
              />
            </div>
            <span className="text-xs tabular text-muted-foreground">
              {tasks.avgProgressPercent}% across {tasks.open} open task
              {tasks.open === 1 ? "" : "s"}
            </span>
          </DetailRow>
          <DetailRow
            label="Work left"
            help="Estimated hours still to run on open tasks, after subtracting time already booked to them. Tasks with no estimate contribute nothing, so this is a floor rather than a forecast."
          >
            <span className="tabular">{formatNumber(tasks.remainingHours, 1)}h</span>
          </DetailRow>
          <DetailRow
            label="On-time delivery"
            help="Completed on or before the due date, counted only over completed tasks that had one."
          >
            {tasks.onTimePercent === null ? (
              <span className="text-muted-foreground">
                No completed task carried a due date
              </span>
            ) : (
              <>
                <span className="tabular">{tasks.onTimePercent}%</span>
                <span className="text-xs text-muted-foreground">
                  {" "}from {tasks.datedCompletedCount} dated task
                  {tasks.datedCompletedCount === 1 ? "" : "s"}
                </span>
              </>
            )}
          </DetailRow>
        </div>

        {estimates.sampleSize > 0 && (
          <p className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">
            <span className="font-medium">Estimates run at {estimates.accuracyPercent}%</span>{" "}
            <span className="text-muted-foreground">
              of what was planned — {formatNumber(estimates.actualHours, 1)}h actual against{" "}
              {formatNumber(estimates.estimatedHours, 1)}h estimated, over {estimates.sampleSize}{" "}
              completed task{estimates.sampleSize === 1 ? "" : "s"}.
              {estimates.sampleSize < 3 && " Too few to be a track record yet."}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Open tasks, soonest due first. */
export function UpcomingTasks({ tasks }: Pick<Workload, "tasks">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open tasks</CardTitle>
        <CardDescription>Soonest due first; undated work last.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {tasks.upcoming.length === 0 ? (
          <EmptyState title="No open tasks assigned" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Task</TH>
                <TH priority="tertiary">Status</TH>
                <TH className="text-right" priority="tertiary">Spent</TH>
                <TH className="text-right" priority="secondary">Progress</TH>
                <TH className="text-right">Due</TH>
              </TR>
            </THead>
            <TBody>
              {tasks.upcoming.map((t) => (
                <TR key={t.id}>
                  <TD>
                    <span className="font-medium">{t.name}</span>
                    {t.project && (
                      <p className="text-xs text-muted-foreground">
                        <Link href={`/projects/${t.project.id}`} className="hover:underline">
                          {t.project.name}
                        </Link>
                      </p>
                    )}
                  </TD>
                  <TD priority="tertiary">
                    <Badge tone={statusTone(t.status)}>{humanize(t.status)}</Badge>
                  </TD>
                  <TD priority="tertiary" className="text-right tabular">
                    {formatNumber(t.hoursSpent, 1)}h
                    {t.estimatedHours !== null && (
                      <p className="text-xs text-muted-foreground">
                        of {formatNumber(t.estimatedHours, 1)}h
                      </p>
                    )}
                  </TD>
                  <TD priority="secondary" className="text-right tabular">
                    {t.completionPercent}%
                  </TD>
                  <TD
                    className={
                      t.overdue
                        ? "text-right font-medium text-red-600 dark:text-red-400"
                        : "text-right"
                    }
                  >
                    {t.dueDate ? formatDate(t.dueDate) : <span className="text-muted-foreground">—</span>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** Which tasks and projects the hours actually went into. */
export function WhereHoursWent({ byTask, byProject }: Pick<Workload, "byTask" | "byProject">) {
  if (byTask.length === 0 && byProject.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Where the hours went</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="No time logged yet"
            description="Once this person logs time, the tasks and projects it went into appear here."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where the hours went</CardTitle>
        <CardDescription>
          Their biggest time sinks, against what each task was estimated at.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <THead>
            <TR>
              <TH>Task</TH>
              <TH priority="tertiary">Project</TH>
              <TH className="text-right" priority="secondary">Estimated</TH>
              <TH className="text-right">Spent</TH>
              <TH className="text-right" priority="tertiary">vs estimate</TH>
            </TR>
          </THead>
          <TBody>
            {byTask.map((t) => (
              <TR key={t.id}>
                <TD>
                  <span className="font-medium">{t.name}</span>
                  {t.status && (
                    <p className="text-xs text-muted-foreground">{humanize(String(t.status))}</p>
                  )}
                </TD>
                <TD priority="tertiary" className="text-sm text-muted-foreground">
                  {t.project ? (
                    <Link href={`/projects/${t.project.id}`} className="hover:underline">
                      {t.project.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TD>
                <TD priority="secondary" className="text-right tabular">
                  {t.estimatedHours === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    `${formatNumber(t.estimatedHours, 1)}h`
                  )}
                </TD>
                <TD className="text-right tabular">{formatNumber(t.hours, 1)}h</TD>
                <TD priority="tertiary" className="text-right">
                  {t.overrunPercent === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Badge
                      tone={
                        t.overrunPercent > 50
                          ? "danger"
                          : t.overrunPercent > 10
                            ? "warning"
                            : "success"
                      }
                    >
                      {t.overrunPercent > 0 ? "+" : ""}
                      {t.overrunPercent}%
                    </Badge>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>

        {byProject.length > 0 && (
          <div className="border-t px-6 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              By project
            </p>
            <div className="mt-2 space-y-1.5">
              {byProject.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link href={`/projects/${p.id}`} className="min-w-0 truncate hover:underline">
                    {p.name}
                    <span className="text-xs text-muted-foreground"> {p.number}</span>
                  </Link>
                  <span className="shrink-0 tabular">{formatNumber(p.hours, 1)}h</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Support tickets owned by this person. */
export function CasePanel({ cases }: Pick<Workload, "cases">) {
  if (cases.total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Support tickets</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="No tickets assigned"
            description="Cases owned by this person appear here, with their SLA state."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Support tickets</CardTitle>
        <CardDescription>
          Cases they own — what is still open, and how the closed ones went.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Open", value: String(cases.open), tone: "" },
            {
              label: "Overdue",
              value: String(cases.overdue),
              tone: cases.overdue > 0 ? "text-red-600 dark:text-red-400" : "",
            },
            {
              label: "SLA breached",
              value: String(cases.breached),
              tone: cases.breached > 0 ? "text-red-600 dark:text-red-400" : "",
            },
            {
              label: "Reopened",
              value: String(cases.reopened),
              tone: cases.reopened > 0 ? "text-amber-600 dark:text-amber-400" : "",
            },
            {
              label: "Closed",
              value: String(cases.closed),
              tone: "text-emerald-600 dark:text-emerald-400",
            },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
              <p className={`mt-1 text-xl font-semibold tabular ${s.tone}`}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <DetailRow
            label="Median time to resolve"
            help="Median rather than mean: one case left open over a holiday would drag an average far enough to misrepresent every other case they handled."
          >
            {cases.medianResolutionHours === null ? (
              <span className="text-muted-foreground">Nothing resolved yet</span>
            ) : (
              <span className="tabular">
                {cases.medianResolutionHours < 48
                  ? `${formatNumber(cases.medianResolutionHours, 1)}h`
                  : `${formatNumber(cases.medianResolutionHours / 24, 1)} days`}
              </span>
            )}
          </DetailRow>
          <DetailRow
            label="Customer satisfaction"
            help="Average of the scores customers left on their cases."
          >
            {cases.avgSatisfaction === null ? (
              <span className="text-muted-foreground">No scores recorded</span>
            ) : (
              <>
                <span className="tabular">{formatNumber(cases.avgSatisfaction, 1)}</span>
                <span className="text-xs text-muted-foreground">
                  {" "}from {cases.satisfactionCount} rated case
                  {cases.satisfactionCount === 1 ? "" : "s"}
                </span>
              </>
            )}
          </DetailRow>
        </div>

        {cases.openList.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Open tickets
            </p>
            {cases.openList.map((c) => (
              <div
                key={c.id}
                className="flex items-start justify-between gap-3 border-b pb-2 text-sm last:border-0"
              >
                <div className="min-w-0">
                  <Link href={`/cases/${c.id}`} className="font-medium hover:underline">
                    {c.subject}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {c.caseNumber}
                    {c.account && ` · ${c.account.name}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone={c.breached || c.overdue ? "danger" : statusTone(c.status)}>
                    {c.breached ? "SLA breached" : humanize(c.status)}
                  </Badge>
                  {c.dueAt && (
                    <p
                      className={
                        c.overdue
                          ? "mt-0.5 text-xs font-medium text-red-600 dark:text-red-400"
                          : "mt-0.5 text-xs text-muted-foreground"
                      }
                    >
                      due {formatDate(c.dueAt)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Money earned and timesheet hygiene, for the side column. */
export function ContributionPanel({ money, quality }: Pick<Workload, "money" | "quality">) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Contribution</CardTitle>
          <CardDescription>
            From the rates stamped on each entry, so a later re-rate cannot
            rewrite what past work earned.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <DetailRow label="Revenue">{formatMoney(money.revenue)}</DetailRow>
          <DetailRow label="Cost">{formatMoney(money.cost)}</DetailRow>
          <DetailRow label="Margin">{formatMoney(money.profit)}</DetailRow>
          <DetailRow label="Margin %">{formatNumber(money.marginPercent, 1)}%</DetailRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timesheet discipline</CardTitle>
          <CardDescription>
            Whether their time arrives and survives approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <DetailRow label="Entries">{String(quality.entries)}</DetailRow>
          <DetailRow
            label="Rejected"
            help="Entries an approver sent back. A high rate usually means the descriptions or the billable flag need attention, not the hours."
          >
            {quality.rejectedEntries} ({formatNumber(quality.rejectedPercent, 1)}%)
          </DetailRow>
          <DetailRow
            label="Unsubmitted"
            help="Still in draft — work that has happened but cannot be invoiced yet."
          >
            {formatNumber(quality.unsubmittedHours, 1)}h
          </DetailRow>
          <DetailRow label="Awaiting approval">
            {formatNumber(quality.awaitingApprovalHours, 1)}h
          </DetailRow>
        </CardContent>
      </Card>
    </>
  );
}

/** The four headline numbers, shown above the existing access tiles. */
export function WorkloadTiles({
  time,
  utilisation,
  tasks,
  cases,
}: Pick<Workload, "time" | "utilisation" | "tasks" | "cases">) {
  return (
    <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Hours this week"
        value={formatNumber(time.week.logged, 1)}
        sublabel={`${formatNumber(utilisation.weekPercent, 0)}% of a 40h week`}
        help="Logged since Monday. Rejected entries excluded."
        tone={
          utilisation.weekPercent >= 70
            ? "success"
            : utilisation.weekPercent >= 30
              ? "warning"
              : "danger"
        }
      />
      <StatTile
        label="Open tasks"
        value={String(tasks.open)}
        sublabel={
          tasks.overdue > 0
            ? `${tasks.overdue} overdue`
            : tasks.dueThisWeek > 0
              ? `${tasks.dueThisWeek} due this week`
              : "none overdue"
        }
        help="Work assigned to them that is not finished or cancelled."
        tone={tasks.overdue > 0 ? "danger" : tasks.open > 0 ? "neutral" : "success"}
      />
      <StatTile
        label="Open tickets"
        value={String(cases.open)}
        sublabel={
          cases.breached > 0
            ? `${cases.breached} SLA breached`
            : cases.overdue > 0
              ? `${cases.overdue} overdue`
              : `${cases.closed} closed to date`
        }
        help="Support cases they own that are not resolved, closed or cancelled."
        tone={cases.breached > 0 || cases.overdue > 0 ? "danger" : "neutral"}
      />
      <StatTile
        label="On-time delivery"
        value={tasks.onTimePercent === null ? "—" : `${tasks.onTimePercent}%`}
        sublabel={
          tasks.datedCompletedCount === 0
            ? "No completed task had a due date"
            : `From ${tasks.datedCompletedCount} dated task${tasks.datedCompletedCount === 1 ? "" : "s"}`
        }
        help="Completed on or before the due date. Only tasks that carried a due date can be judged, so those are the denominator."
        tone={
          tasks.onTimePercent === null || tasks.datedCompletedCount < 3
            ? "neutral"
            : tasks.onTimePercent >= 85
              ? "success"
              : tasks.onTimePercent >= 60
                ? "warning"
                : "danger"
        }
      />
    </div>
  );
}
