import Link from "next/link";
import { notFound } from "next/navigation";
import { getResourceDetail } from "@/server/timesheets";
import {
  PageHeader, Card, CardHeader, CardTitle, CardDescription, CardContent,
  Table, THead, TBody, TR, TH, TD, Badge, statusTone, StatTile, Select,
  Button, Forbidden, EmptyState, DetailRow,
} from "@/components/ui";
import { formatDate, formatNumber, formatMoney, humanize } from "@/lib/utils";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { FilterForm } from "@/components/filter-form";

/**
 * One person's delivery record.
 *
 * The list page answers "is this person busy". This one answers what a booker
 * actually needs before handing over the next piece of work: how much of what
 * they are booked for turns into logged hours, whether their estimates hold,
 * and whether their work lands on the date it was promised for.
 *
 * Every figure is arithmetic over what has been recorded — none of it is
 * projected forward. Where a ratio rests on very few tasks the sample size is
 * printed beside it, because a number like "140% of estimate" drawn from two
 * tasks reads as a verdict on somebody when it is really just noise.
 */
export default async function ResourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ weeks?: string }>;
}) {
  const _me = await requireUser();

  // Same gate as the list it is reached from — this page carries cost rates and
  // one person's approval history, so it is more sensitive than the roster.
  if (!can(_me, PERMISSIONS.TIME_APPROVE)) {
    return <Forbidden what="resource utilisation" />;
  }

  const { id } = await params;
  const { weeks } = await searchParams;
  // `Number(weeks) || 12` would read "0" as absent and fall back to the default
  // rather than clamping it to the minimum, so the parse and the fallback are
  // kept apart: anything that is not a finite number is absent, and anything
  // that is gets clamped.
  const requested = Number(weeks);
  const window = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), 52)
    : 12;

  const data = await getResourceDetail(id, window);
  if (!data) notFound();

  const { user, hours, margin, delivery, estimates, timeQuality } = data;
  const over = data.allocatedPercent > 100;

  // Peak is the scale for the trend bars. Falling back to capacity keeps a
  // quiet period looking quiet instead of rescaling a 2-hour week to full height.
  const weeklyCapacity = 40;
  const peakWeek = Math.max(weeklyCapacity, ...data.weekly.map((w) => w.hours));

  return (
    <>
      <PageHeader
        title={user.fullName}
        backTo="/resources"
        backLabel="Back to resources"
        description={`${user.jobTitle ?? "No job title"}${
          user.department ? ` · ${user.department.name}` : ""
        }. Delivery and time from ${formatDate(data.from)} to ${formatDate(data.to)}.`}
      >
        <FilterForm className="flex items-center gap-2">
          <Select name="weeks" defaultValue={String(window)} className="w-36">
            {[4, 8, 12, 26, 52].map((w) => (
              <option key={w} value={w}>Last {w} weeks</option>
            ))}
          </Select>
          <Button type="button" variant="secondary">Apply</Button>
        </FilterForm>
      </PageHeader>

      {/* The four numbers that decide whether this person can take more work. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Booked"
          value={`${formatNumber(data.allocatedPercent, 0)}%`}
          sublabel={
            over
              ? `${formatNumber(data.allocatedPercent - 100, 0)}% past full`
              : `${formatNumber(data.headroomPercent, 0)}% headroom`
          }
          help="Total allocation across active projects. This is the promise made to projects, not hours actually worked."
          tone={over ? "danger" : data.allocatedPercent === 0 ? "neutral" : "success"}
        />
        <StatTile
          label="Billable utilisation"
          value={`${formatNumber(hours.billableUtilisationPercent, 0)}%`}
          sublabel={`${formatNumber(hours.billable, 1)}h of ${formatNumber(data.capacityHours, 0)}h`}
          help="Billable hours against a 40-hour week for the window. The industry benchmark for a delivery role is 70–80%."
          tone={
            hours.billableUtilisationPercent >= 70
              ? "success"
              : hours.billableUtilisationPercent >= 40
                ? "warning"
                : "danger"
          }
        />
        <StatTile
          label="Estimate accuracy"
          value={estimates.accuracyPercent === null ? "—" : `${formatNumber(estimates.accuracyPercent, 0)}%`}
          sublabel={
            estimates.sampleSize === 0
              ? "No completed task has both an estimate and logged time"
              : `From ${estimates.sampleSize} completed task${estimates.sampleSize === 1 ? "" : "s"}`
          }
          help="Actual hours as a share of estimated hours on completed tasks. 100% is on the nose; above it means the work ran over."
          tone={
            estimates.accuracyPercent === null || estimates.sampleSize < 3
              ? "neutral"
              : estimates.accuracyPercent <= 110
                ? "success"
                : estimates.accuracyPercent <= 140
                  ? "warning"
                  : "danger"
          }
        />
        <StatTile
          label="On-time delivery"
          value={delivery.onTimePercent === null ? "—" : `${delivery.onTimePercent}%`}
          sublabel={
            delivery.datedCompletedCount === 0
              ? "No completed task carried a due date"
              : `From ${delivery.datedCompletedCount} dated task${delivery.datedCompletedCount === 1 ? "" : "s"}`
          }
          help="Completed on or before the due date, counted only over tasks that had one."
          tone={
            delivery.onTimePercent === null || delivery.datedCompletedCount < 3
              ? "neutral"
              : Number(delivery.onTimePercent) >= 85
                ? "success"
                : Number(delivery.onTimePercent) >= 60
                  ? "warning"
                  : "danger"
          }
        />
      </div>

      {estimates.sampleSize > 0 && estimates.sampleSize < 3 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Estimate accuracy and on-time delivery here rest on very few completed
          tasks. Treat them as an early hint rather than a track record.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Hours per week. A single average hides the shape of someone's load. */}
          <Card>
            <CardHeader>
              <CardTitle>Hours per week</CardTitle>
              <CardDescription>
                Billable in solid, non-billable stacked above. The line marks a
                40-hour week.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.weekly.every((w) => w.hours === 0) ? (
                <EmptyState title="No time logged in this window" />
              ) : (
                <>
                  <div className="flex h-40 items-end gap-1">
                    {data.weekly.map((w) => {
                      const nonBillable = Math.max(0, w.hours - w.billableHours);
                      return (
                        <div
                          key={w.weekStart}
                          className="group relative flex flex-1 flex-col justify-end"
                          title={`Week of ${formatDate(w.weekStart)} — ${formatNumber(w.hours, 1)}h logged, ${formatNumber(w.billableHours, 1)}h billable`}
                        >
                          <div
                            className="w-full rounded-t-sm bg-muted-foreground/25"
                            style={{ height: `${(nonBillable / peakWeek) * 100}%` }}
                          />
                          <div
                            className="w-full bg-emerald-500"
                            style={{ height: `${(w.billableHours / peakWeek) * 100}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                    <span>{formatDate(data.weekly[0]?.weekStart)}</span>
                    <span>{formatDate(data.weekly[data.weekly.length - 1]?.weekStart)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Allocation against reality, per project. */}
          <Card>
            <CardHeader>
              <CardTitle>Projects</CardTitle>
              <CardDescription>
                What each project booked them for, against the hours that
                actually landed on it.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {data.byProject.length === 0 ? (
                <EmptyState title="Not booked on any active project" />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Project</TH>
                      <TH priority="tertiary">Role</TH>
                      <TH className="text-right" priority="secondary">Booked</TH>
                      <TH className="text-right">Hours</TH>
                      <TH className="text-right" priority="tertiary">Open tasks</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.byProject.map((p) => (
                      <TR key={p.project.id}>
                        <TD>
                          <Link href={`/projects/${p.project.id}`} className="font-medium hover:underline">
                            {p.project.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">{p.project.projectNumber}</p>
                        </TD>
                        <TD priority="tertiary" className="text-sm text-muted-foreground">
                          {p.projectRole}
                        </TD>
                        <TD priority="secondary" className="text-right">
                          <Badge tone={p.allocationPercent === 0 ? "neutral" : "info"}>
                            {formatNumber(p.allocationPercent, 0)}%
                          </Badge>
                        </TD>
                        <TD className="text-right tabular">
                          {formatNumber(p.hours, 1)}
                          <p className="text-xs text-muted-foreground">
                            {formatNumber(p.billableHours, 1)}h billable
                          </p>
                        </TD>
                        <TD priority="tertiary" className="text-right tabular">
                          {p.openTasks}
                          {p.overdueTasks > 0 && (
                            <p className="text-xs text-red-600 dark:text-red-400">
                              {p.overdueTasks} overdue
                            </p>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Where estimates went wrong — the actionable half of the accuracy tile. */}
          {estimates.worst.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Biggest estimate overruns</CardTitle>
                <CardDescription>
                  Completed tasks that took most beyond what they were estimated
                  at. Useful for spotting which kind of work gets under-called.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Task</TH>
                      <TH className="text-right" priority="tertiary">Estimated</TH>
                      <TH className="text-right" priority="secondary">Actual</TH>
                      <TH className="text-right">Overrun</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {estimates.worst.map((t) => (
                      <TR key={t.id}>
                        <TD>
                          <span className="font-medium">{t.name}</span>
                          {t.project && (
                            <p className="text-xs text-muted-foreground">{t.project.name}</p>
                          )}
                        </TD>
                        <TD priority="tertiary" className="text-right tabular">
                          {formatNumber(t.estimate, 1)}h
                        </TD>
                        <TD priority="secondary" className="text-right tabular">
                          {formatNumber(t.actual, 1)}h
                        </TD>
                        <TD className="text-right">
                          <Badge tone={t.overrunPercent > 50 ? "danger" : "warning"}>
                            +{formatNumber(t.overrunPercent, 0)}%
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* What is due next — the forward-looking half. */}
          <Card>
            <CardHeader>
              <CardTitle>Next due</CardTitle>
              <CardDescription>Open tasks with a due date, soonest first.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {data.upcomingTasks.length === 0 ? (
                <EmptyState title="No open tasks carry a due date" />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Task</TH>
                      <TH priority="tertiary">Status</TH>
                      <TH className="text-right" priority="secondary">Progress</TH>
                      <TH className="text-right">Due</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.upcomingTasks.map((t) => {
                      const overdue =
                        t.dueDate && String(t.dueDate) < new Date().toISOString().slice(0, 10);
                      return (
                        <TR key={String(t.id)}>
                          <TD>
                            <span className="font-medium">{String(t.name)}</span>
                            {t.project && (
                              <p className="text-xs text-muted-foreground">{t.project.name}</p>
                            )}
                          </TD>
                          <TD priority="tertiary">
                            <Badge tone={statusTone(String(t.status))}>
                              {humanize(String(t.status))}
                            </Badge>
                          </TD>
                          <TD priority="secondary" className="text-right tabular">
                            {formatNumber(Number(t.completionPercent ?? 0), 0)}%
                          </TD>
                          <TD
                            className={
                              overdue
                                ? "text-right font-medium text-red-600 dark:text-red-400"
                                : "text-right"
                            }
                          >
                            {formatDate(t.dueDate as string)}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Side column: the person, then the numbers that qualify the headline ones. */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Person</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DetailRow label="Email">{user.email}</DetailRow>
              <DetailRow label="Employee number">{user.employeeNumber ?? "—"}</DetailRow>
              <DetailRow label="Department">{user.department?.name ?? "—"}</DetailRow>
              <DetailRow label="Manager">
                {user.manager ? (
                  <Link href={`/resources/${user.manager.id}`} className="hover:underline">
                    {user.manager.fullName}
                  </Link>
                ) : (
                  "—"
                )}
              </DetailRow>
              <DetailRow label="Billing rate">{formatMoney(user.defaultBillingRate)}</DetailRow>
              <DetailRow label="Cost rate">{formatMoney(user.costRate)}</DetailRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Task load</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DetailRow label="Open">{String(delivery.openTasks)}</DetailRow>
              <DetailRow label="Overdue">
                {delivery.overdueTasks > 0 ? (
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {delivery.overdueTasks}
                  </span>
                ) : (
                  "0"
                )}
              </DetailRow>
              <DetailRow
                label="Blocked"
                help="Blocked work is usually waiting on someone else — it is capacity that looks committed but is not moving."
              >
                {delivery.blockedTasks > 0 ? (
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {delivery.blockedTasks}
                  </span>
                ) : (
                  "0"
                )}
              </DetailRow>
              <DetailRow label="Completed">{String(delivery.completedTasks)}</DetailRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hours</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DetailRow label="Logged">{`${formatNumber(hours.logged, 1)}h`}</DetailRow>
              <DetailRow label="Billable">{`${formatNumber(hours.billable, 1)}h`}</DetailRow>
              <DetailRow label="Non-billable">{`${formatNumber(hours.nonBillable, 1)}h`}</DetailRow>
              <DetailRow
                label="Billable ratio"
                help="Share of the hours they did log that were billable — separate from utilisation, which measures against a full week."
              >
                {`${formatNumber(hours.billableRatioPercent, 0)}%`}
              </DetailRow>
              <DetailRow label="Utilisation" help="All logged hours against a 40-hour week.">
                {`${formatNumber(hours.utilisationPercent, 0)}%`}
              </DetailRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contribution</CardTitle>
              <CardDescription>
                From the rates stamped on each entry, so a later re-rate cannot
                rewrite what past work earned.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <DetailRow label="Revenue">{formatMoney(margin.revenue)}</DetailRow>
              <DetailRow label="Cost">{formatMoney(margin.cost)}</DetailRow>
              <DetailRow label="Margin">{formatMoney(margin.profit)}</DetailRow>
              <DetailRow label="Margin %">
                {`${formatNumber(margin.marginPercent, 1)}%`}
              </DetailRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timesheet discipline</CardTitle>
              <CardDescription>
                Whether their time arrives on time and survives approval.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <DetailRow label="Entries">{String(timeQuality.entries)}</DetailRow>
              <DetailRow
                label="Rejected"
                help="Entries an approver sent back. A high rate usually means the descriptions or the billable flag need attention, not the hours."
              >
                {`${timeQuality.rejectedEntries} (${formatNumber(timeQuality.rejectedPercent, 1)}%)`}
              </DetailRow>
              <DetailRow
                label="Unsubmitted"
                help="Still in draft — work that has happened but cannot be invoiced yet."
              >
                {`${formatNumber(timeQuality.unsubmittedHours, 1)}h`}
              </DetailRow>
              <DetailRow label="Awaiting approval">
                {`${formatNumber(timeQuality.awaitingApprovalHours, 1)}h`}
              </DetailRow>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
