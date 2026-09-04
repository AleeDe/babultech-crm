import Link from "next/link";
import { Kpi, AttentionList } from "@/components/dashboard-kit";
import { formatCompactMoney, formatDate, formatNumber, cn } from "@/lib/utils";
import type { ModuleSummary } from "@/server/dashboard";

interface ProjectRow {
  id: string;
  name: string;
  projectNumber: string;
  accountName: string | null;
  status: string;
  health: string;
  plannedEndDate: string | null;
  hours: number;
  billableHours: number;
  revenue: number;
  cost: number;
  margin: number;
  marginPercent: number | null;
  unapprovedHours: number;
  unbilledValue: number;
  burnPercent: number | null;
  overBudget: boolean;
}

/**
 * The delivery portfolio, deep enough to run a week from.
 *
 * The first version had four counts and a list of projects by hours, which says
 * how busy people are and nothing about whether the work is worth doing. A
 * delivery lead opens this asking four things: are we making money, what is
 * about to slip, what have we finished but not billed, and which projects are
 * eating their budget. Each now has a section.
 *
 * The portfolio table is the centre of the screen rather than a footnote,
 * because the per-project row is where all four questions actually resolve — a
 * summary figure tells you there is a problem, the table tells you which project
 * it is.
 *
 * Margin is shown only where there is revenue to divide by. A project with
 * approved time but nothing billable has no margin percentage, and printing 0%
 * would read as "we are making nothing on this" rather than "this is not a
 * billable engagement".
 */
export function DeliveryView({
  summary,
  attention,
  analytics,
}: {
  summary: ModuleSummary;
  attention: { breachedCases: Record<string, any>[] };
  analytics: {
    rows: ProjectRow[];
    totals: {
      hours: number;
      billableHours: number;
      revenue: number;
      cost: number;
      margin: number;
      marginPercent: number | null;
      billablePercent: number;
      unbilledValue: number;
      unapprovedHours: number;
    };
    upcomingMilestones: {
      id: string;
      name: string;
      projectId: string;
      projectName: string;
      dueDate: string;
      amount: number;
      overdue: boolean;
    }[];
  };
}) {
  const { rows, totals, upcomingMilestones } = analytics;

  const overBudget = rows.filter((r) => r.overBudget);
  const thinMargin = rows.filter((r) => r.marginPercent !== null && r.marginPercent < 20);
  const overdueMilestones = upcomingMilestones.filter((m) => m.overdue);

  const attentionItems = [
    {
      id: "at-risk",
      count: summary.delivery.atRiskProjects,
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
      detail: `${formatNumber(totals.unapprovedHours, 1)} hours · ${formatCompactMoney(totals.unbilledValue)} cannot be invoiced yet`,
      href: "/timesheets/approvals",
      tone: "warning" as const,
    },
    {
      id: "overdue-tasks",
      count: summary.delivery.overdueTasks,
      title: "Tasks past their due date",
      href: "/projects",
      tone: "warning" as const,
    },
  ].filter((i) => i.count > 0);

  return (
    <div className="space-y-6">
      {/* ------------------------------------ is the portfolio making money? */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Margin to date"
          value={formatCompactMoney(totals.margin)}
          sublabel={
            totals.marginPercent === null
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
          value={formatCompactMoney(totals.unbilledValue)}
          sublabel={`${formatNumber(totals.unapprovedHours, 1)} hours not yet approved`}
          // Down is good: unbilled work is revenue you have earned and not asked
          // for, so a rising figure means money is stuck, not money is coming.
          goodDirection="down"
          module="delivery"
          href="/timesheets/approvals"
        />
        <Kpi
          label="Active projects"
          value={String(summary.delivery.activeProjects)}
          sublabel={
            summary.delivery.atRiskProjects > 0
              ? `${summary.delivery.atRiskProjects} at risk`
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
                          {r.revenue > 0 ? formatCompactMoney(r.revenue) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {r.cost > 0 ? formatCompactMoney(r.cost) : "—"}
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
