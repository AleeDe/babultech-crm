import Link from "next/link";
import { Kpi, AttentionList } from "@/components/dashboard-kit";
import { formatCompactMoney, formatDate, formatNumber, cn } from "@/lib/utils";
import type { getDeliveryAnalytics } from "@/server/dashboard";

type Analytics = NonNullable<Awaited<ReturnType<typeof getDeliveryAnalytics>>>;

/**
 * The delivery portfolio, deep enough to run a week from.
 *
 * A delivery lead opens this asking six things: is the work getting done, is
 * the backlog growing, are we making money, what is about to slip, who is
 * over-loaded, and what have we finished but not billed. Each has a section.
 *
 * Two kinds of figure share the screen and the labels keep them apart. Period
 * figures ("hours logged", "tasks completed") answer what happened inside the
 * chosen range. Point-in-time figures ("open tasks", "overdue") answer what is
 * true now and deliberately ignore the range — "tasks open in August" is not a
 * real quantity, and filtering it would produce a confident, meaningless
 * number. Anything under `current` is of the second kind and says "now".
 *
 * Margin is shown only where there is revenue to divide by. A project with
 * approved time but nothing billable has no margin percentage, and printing 0%
 * would read as "we are making nothing on this" rather than "this is not a
 * billable engagement".
 */
export function DeliveryView({
  analytics,
}: {
  analytics: Analytics;
}) {
  const { ratesVisible, rows, totals, upcomingMilestones, period, current, previous, people, daily, range } =
    analytics;

  /** Period-on-period direction. Null when there is nothing to compare against. */
  const delta = (now: number, before: number | undefined) => {
    if (before === undefined || before === 0) return null;
    return Math.round(((now - before) / before) * 100);
  };
  const deltaHours = previous ? delta(period.hours, previous.hours) : null;
  // Floor of 8 so a single quiet day does not scale one bar to full height.
  const dailyPeak = daily.length ? Math.max(8, ...daily.map((d) => d.hours)) : 8;

  const overBudget = rows.filter((r) => r.overBudget);
  const thinMargin = rows.filter((r) => r.marginPercent !== null && r.marginPercent < 20);
  const overdueMilestones = upcomingMilestones.filter((m) => m.overdue);

  const attentionItems = [
    {
      id: "at-risk",
      count: current.projectsAtRisk,
      title: "Projects flagged at risk",
      detail: "Health is amber or red - someone has said so deliberately",
      href: "/projects",
      tone: "critical" as const,
    },
    {
      id: "over-budget",
      count: overBudget.length,
      title: "Projects past their approved hours",
      detail: overBudget.slice(0, 3).map((r) => r.name).join(" · "),
      href: "/projects",
      tone: "critical" as const,
    },
    {
      id: "milestones-overdue",
      count: overdueMilestones.length,
      title: "Milestones past due and not invoiced",
      detail: `${formatCompactMoney(overdueMilestones.reduce((s, m) => s + m.amount, 0))} not yet billed`,
      href: "/projects",
      tone: "critical" as const,
    },
    {
      id: "thin-margin",
      count: thinMargin.length,
      title: "Projects running under 20% margin",
      detail: thinMargin.slice(0, 3).map((r) => r.name).join(" · "),
      href: "/projects",
      tone: "warning" as const,
    },
    {
      id: "unapproved",
      count: totals.unapprovedHours > 0 ? 1 : 0,
      title: "Time waiting on approval",
      detail: `${formatNumber(totals.unapprovedHours, 1)} hours · ${ratesVisible ? formatCompactMoney(totals.unbilledValue) : "Value restricted"} cannot be invoiced yet`,
      href: "/timesheets/approvals",
      tone: "warning" as const,
    },
    {
      id: "overdue-tasks",
      count: current.overdueTasks,
      title: "Tasks past their due date",
      href: "/projects",
      tone: "warning" as const,
    },
  ].filter((i) => i.count > 0);

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------- who is loaded? */}
      {people.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">Resources</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Allocation is what people are booked for and is current; hours and
            utilisation are for the selected period.
          </p>
          <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="People active"
              value={String(current.peopleActive)}
              sublabel={`${current.peopleBooked} booked on a project`}
            />
            <Kpi
              label="Over-allocated"
              value={String(current.peopleOverAllocated)}
              sublabel="booked past 100%"
            />
            <Kpi
              label="On no project"
              value={String(current.peopleUnallocated)}
            />
            <Kpi
              label="Team utilisation"
              value={
                period.utilisationPercent === null
                  ? "—"
                  : `${formatNumber(period.utilisationPercent, 0)}%`
              }
              sublabel={
                period.billableUtilisationPercent === null
                  ? undefined
                  : `${formatNumber(period.billableUtilisationPercent, 0)}% billable · ${period.workingDays ?? 0} working days`
              }
            />
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-4 py-2 text-right font-medium">Booked</th>
                  <th className="px-4 py-2 text-right font-medium">Hours</th>
                  <th className="px-4 py-2 text-right font-medium">Utilisation</th>
                  <th className="px-4 py-2 text-right font-medium">Open tasks</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/resources/${p.id}`} className="font-medium hover:underline">
                        {p.fullName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {p.jobTitle ?? "—"} · {p.projects} project{p.projects === 1 ? "" : "s"}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <span
                        className={
                          p.allocatedPercent > 100
                            ? "font-medium text-red-600 dark:text-red-400"
                            : ""
                        }
                      >
                        {formatNumber(p.allocatedPercent, 0)}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatNumber(p.hours, 1)}
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(p.billableHours, 1)}h billable
                      </p>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {p.utilisationPercent === null
                        ? "—"
                        : `${formatNumber(p.utilisationPercent, 0)}%`}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {p.openTasks}
                      {p.overdueTasks > 0 && (
                        <p className="text-xs text-red-600 dark:text-red-400">
                          {p.overdueTasks} overdue
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Who is on what, in detail. The table above says how loaded each
              person is; this says what they are loaded *with*, which is the
              question a delivery lead actually acts on. */}
          <div className="mt-4 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Current allocation — what each person is working on
            </p>
            {people
              .filter((p) => p.allocatedPercent > 0 || p.hours > 0 || p.openTasks > 0)
              .map((p) => (
                <div key={p.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/resources/${p.id}`} className="font-medium hover:underline">
                        {p.fullName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {p.jobTitle ?? "—"} · booked {formatNumber(p.allocatedPercent, 0)}% across{" "}
                        {p.projects} project{p.projects === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        {formatNumber(p.hours, 1)}h
                      </span>{" "}
                      logged
                      {p.utilisationPercent !== null && (
                        <p>{formatNumber(p.utilisationPercent, 0)}% utilised</p>
                      )}
                    </div>
                  </div>

                  {/* Hours by project, as a single proportional bar. */}
                  {p.projectBreakdown.length > 0 && (
                    <div className="mt-3">
                      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                        {p.projectBreakdown.map((proj, i) => (
                          <div
                            key={proj.id}
                            title={`${proj.name} — ${formatNumber(proj.hours, 1)}h`}
                            className={
                              ["bg-emerald-500", "bg-blue-500", "bg-amber-500", "bg-violet-500", "bg-rose-500"][i % 5]
                            }
                            style={{ width: `${(proj.hours / Math.max(p.hours, 0.01)) * 100}%` }}
                          />
                        ))}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {p.projectBreakdown.map((proj, i) => (
                          <span key={proj.id} className="inline-flex items-center gap-1">
                            <span
                              aria-hidden
                              className={`h-2 w-2 rounded-full ${["bg-emerald-500", "bg-blue-500", "bg-amber-500", "bg-violet-500", "bg-rose-500"][i % 5]}`}
                            />
                            <Link href={`/projects/${proj.id}`} className="hover:underline">
                              {proj.name}
                            </Link>
                            <span className="tabular-nums">{formatNumber(proj.hours, 1)}h</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Where the hours went, task by task. */}
                  {p.taskBreakdown.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Time went into</p>
                      {p.taskBreakdown.map((t) => (
                        <div key={t.id} className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">
                            {t.name}
                            {t.projectName && (
                              <span className="text-xs text-muted-foreground"> · {t.projectName}</span>
                            )}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatNumber(t.hours, 1)}h
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* What they are holding, for the person who has logged nothing. */}
                  {p.currentTasks.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        Open now ({p.openTasks})
                      </p>
                      {p.currentTasks.map((t) => (
                        <div key={t.id} className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">
                            {t.name}
                            {t.projectName && (
                              <span className="text-xs text-muted-foreground"> · {t.projectName}</span>
                            )}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-xs tabular-nums",
                              t.overdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground",
                            )}
                          >
                            {t.completionPercent}%
                            {t.dueDate && ` · due ${formatDate(t.dueDate)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {p.taskBreakdown.length === 0 && p.currentTasks.length === 0 && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Booked {formatNumber(p.allocatedPercent, 0)}% but holding no open tasks and
                      logging no time in this period.
                    </p>
                  )}
                </div>
              ))}
          </div>
        </section>
      )}

      {people.length === 0 && (
        <section className="rounded-xl border bg-card p-6">
          <h2 className="text-sm font-semibold">Resources</h2>
          <p className="mt-2 text-sm text-muted-foreground">No resources match these filters. Try another project or clear the filters.</p>
        </section>
      )}
      {/* ------------------------------------------- is the work getting done? */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Work done{" "}
          <span className="font-normal text-muted-foreground">· {range.label}</span>
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Hours logged"
            value={formatNumber(period.hours, 1)}
            delta={deltaHours}
            sublabel={
              period.utilisationPercent !== null
                ? `${formatNumber(period.utilisationPercent, 0)}% of ${formatNumber(period.capacityHours ?? 0, 0)}h capacity`
                : `${period.entries} entries`
            }
          />
          <Kpi
            label="Tasks completed"
            value={String(period.tasksCompleted)}
            sublabel={`${period.tasksCreated} created in the same period`}
            delta={previous ? delta(period.tasksCompleted, previous.tasksCompleted) : null}
          />
          <Kpi
            label="Backlog change"
            value={`${period.backlogChange > 0 ? "+" : ""}${period.backlogChange}`}
            sublabel={
              period.backlogChange > 0
                ? "more work arrived than was finished"
                : period.backlogChange < 0
                  ? "finished more than arrived"
                  : "arrived and finished in balance"
            }
          />
          <Kpi
            label="Billable share"
            value={
              period.billablePercent === null ? "—" : `${formatNumber(period.billablePercent, 0)}%`
            }
            sublabel={`${formatNumber(period.billableHours, 1)}h billable · ${formatNumber(period.nonBillableHours, 1)}h not`}
          />
        </div>

        {previous && (
          <p className="mt-2 text-xs text-muted-foreground">
            Against the previous period: {formatNumber(previous.hours, 1)}h logged,{" "}
            {previous.tasksCompleted} task{previous.tasksCompleted === 1 ? "" : "s"} completed
            {deltaHours !== null && ` · hours ${deltaHours > 0 ? "up" : deltaHours < 0 ? "down" : "level"}${deltaHours === 0 ? "" : ` ${Math.abs(deltaHours)}%`}`}
            .
          </p>
        )}

        {(period.onTimePercent !== null || period.estimateAccuracyPercent !== null) && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {period.onTimePercent !== null && (
              <Kpi
                label="On-time delivery"
                value={`${period.onTimePercent}%`}
                sublabel={`from ${period.datedCompletedCount} completed task${period.datedCompletedCount === 1 ? "" : "s"} that carried a due date`}
              />
            )}
            {period.estimateAccuracyPercent !== null && (
              <Kpi
                label="Estimate accuracy"
                value={`${period.estimateAccuracyPercent}%`}
                sublabel={`actual against estimated, over ${period.estimateSampleSize} completed task${period.estimateSampleSize === 1 ? "" : "s"}${period.estimateSampleSize < 3 ? " — too few to trust yet" : ""}`}
              />
            )}
          </div>
        )}

        {daily.length > 1 && (
          <div className="mt-4 rounded-xl border bg-card p-4">
            <p className="text-sm font-medium">Hours per day</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Billable in solid, non-billable stacked above. Gaps are days nobody logged.
            </p>
            <div className="flex h-24 items-end gap-px">
              {daily.map((d) => {
                const non = Math.max(0, d.hours - d.billableHours);
                return (
                  <div
                    key={d.day}
                    className="flex flex-1 flex-col justify-end"
                    title={`${formatDate(d.day)} — ${formatNumber(d.hours, 1)}h logged, ${formatNumber(d.billableHours, 1)}h billable`}
                  >
                    <div
                      className="w-full rounded-t-sm bg-muted-foreground/25"
                      style={{ height: `${(non / dailyPeak) * 100}%` }}
                    />
                    <div
                      className="w-full bg-emerald-500"
                      style={{ height: `${(d.billableHours / dailyPeak) * 100}%` }}
                    />
                    {d.hours === 0 && <div className="h-px w-full bg-border" />}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{formatDate(daily[0].day)}</span>
              <span>{formatDate(daily[daily.length - 1].day)}</span>
            </div>
          </div>
        )}
      </section>

      {/* --------------------------------------------- what is open right now? */}
      <section>
        <h2 className="mb-1 text-sm font-semibold">Open work</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          As of today. These count what is open now, so they deliberately ignore
          the date filter — tasks open last month is not a real quantity.
        </p>
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "Open tasks", value: current.openTasks, note: `of ${current.totalTasks} ever`, tone: "" },
            { label: "Not started", value: current.notStartedTasks, note: "", tone: "" },
            { label: "In progress", value: current.inProgressTasks, note: "", tone: "" },
            { label: "In review", value: current.inReviewTasks, note: "", tone: "" },
            {
              label: "Blocked",
              value: current.blockedTasks,
              note: "",
              tone: current.blockedTasks > 0 ? "text-amber-600 dark:text-amber-400" : "",
            },
            {
              label: "Overdue",
              value: current.overdueTasks,
              note: "",
              tone: current.overdueTasks > 0 ? "text-red-600 dark:text-red-400" : "",
            },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border bg-card p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
              <p className={cn("mt-1 text-2xl font-semibold tabular-nums", s.tone)}>{s.value}</p>
              {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Due in 7 days", value: String(current.dueSoonTasks), note: "", tone: "" },
            {
              label: "Unassigned",
              value: String(current.unassignedTasks),
              note: "nobody is doing these",
              tone: current.unassignedTasks > 0 ? "text-amber-600 dark:text-amber-400" : "",
            },
            {
              label: "Work left",
              value: `${formatNumber(current.remainingHours, 0)}h`,
              note: "estimated hours still to run on open tasks",
              tone: "",
            },
            {
              label: "Completed all time",
              value: String(current.completedTasksAllTime),
              note: "",
              tone: "",
            },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border bg-card p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
              <p className={cn("mt-1 text-xl font-semibold tabular-nums", s.tone)}>{s.value}</p>
              {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------ is the portfolio making money? */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Margin to date"
          value={ratesVisible ? formatCompactMoney(totals.margin) : "Restricted"}
          sublabel={
            !ratesVisible ? "Financial access required" : totals.marginPercent === null
              ? "Nothing billable approved yet"
              : `${formatNumber(totals.marginPercent, 0)}% of ${formatCompactMoney(totals.revenue)} billed`
          }
          module="delivery"
          emphasis
        />
        <Kpi
          label="Billable ratio"
          value={`${formatNumber(totals.billablePercent, 0)}%`}
          sublabel={`${formatNumber(totals.billableHours, 0)} of ${formatNumber(totals.hours, 0)} hours`}
          module="delivery"
        />
        <Kpi
          label="Unbilled value"
          value={ratesVisible ? formatCompactMoney(totals.unbilledValue) : "Restricted"}
          sublabel={`${formatNumber(totals.unapprovedHours, 1)} hours not yet approved`}
          // Down is good: unbilled work is revenue you have earned and not asked
          // for, so a rising figure means money is stuck, not money is coming.
          goodDirection="down"
          module="delivery"
          href="/timesheets/approvals"
        />
        <Kpi
          label="Active projects"
          value={String(current.activeProjects)}
          sublabel={
            current.projectsAtRisk > 0
              ? `${current.projectsAtRisk} at risk`
              : "All healthy"
          }
          module="delivery"
          href="/projects"
        />
      </div>

      {attentionItems.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
          <AttentionList items={attentionItems} />
        </section>
      )}

      {/* ------------------------------------------------ the portfolio table */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Every live project</h2>
        <div className="overflow-hidden rounded-xl border bg-card">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No live projects.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Project</th>
                    <th className="px-3 py-2 text-right font-medium">Hours</th>
                    <th className="px-3 py-2 text-right font-medium">Billable</th>
                    <th className="px-3 py-2 text-right font-medium">Revenue</th>
                    <th className="px-3 py-2 text-right font-medium">Cost</th>
                    <th className="px-3 py-2 text-right font-medium">Margin</th>
                    <th className="px-4 py-2 text-right font-medium">Budget</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows
                    .slice()
                    .sort((a, b) => b.hours - a.hours)
                    .map((r) => (
                      <tr key={r.id} className="transition-colors hover:bg-muted/40">
                        <td className="px-4 py-2.5">
                          <Link href={`/projects/${r.id}`} className="font-medium hover:underline">
                            {r.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {/* Health is a word as well as a colour: a red dot
                                alone is unreadable to a colourblind reader, and
                                this table has no room for a legend. */}
                            <span
                              className={cn(
                                r.health === "RED"
                                  ? "text-red-600 dark:text-red-400"
                                  : r.health === "AMBER"
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {r.health === "RED" ? "At risk" : r.health === "AMBER" ? "Watch" : "On track"}
                            </span>
                            {r.accountName && ` · ${r.accountName}`}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatNumber(r.hours, 1)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {r.hours > 0 ? `${formatNumber((r.billableHours / r.hours) * 100, 0)}%` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {ratesVisible && r.revenue > 0 ? formatCompactMoney(r.revenue) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {ratesVisible && r.cost > 0 ? formatCompactMoney(r.cost) : "—"}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right font-medium tabular-nums",
                            r.margin < 0 && "text-red-600 dark:text-red-400",
                          )}
                        >
                          {r.marginPercent === null
                            ? "—"
                            : `${formatNumber(r.marginPercent, 0)}%`}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {r.burnPercent === null ? (
                            <span className="text-xs text-muted-foreground">No budget</span>
                          ) : (
                            <span
                              className={cn(
                                "text-xs tabular-nums",
                                r.overBudget
                                  ? "font-medium text-red-600 dark:text-red-400"
                                  : r.burnPercent > 80
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-muted-foreground",
                              )}
                            >
                              {formatNumber(r.burnPercent, 0)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* -------------------------------------- what turns into money next */}
      {upcomingMilestones.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Milestones to bill</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Due within 30 days and not yet invoiced. A missed milestone is usually a
            missed invoice.
          </p>
          <div className="overflow-hidden rounded-xl border bg-card">
            <ul className="divide-y">
              {upcomingMilestones.slice(0, 8).map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className={cn(
                      "w-24 shrink-0 text-xs tabular-nums",
                      m.overdue
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatDate(m.dueDate)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{m.name}</span>
                    <Link
                      href={`/projects/${m.projectId}`}
                      className="block truncate text-xs text-muted-foreground hover:underline"
                    >
                      {m.projectName}
                    </Link>
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatCompactMoney(m.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
