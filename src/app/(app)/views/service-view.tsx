import Link from "next/link";
import { Kpi, AttentionList } from "@/components/dashboard-kit";
import { formatNumber, humanize, cn } from "@/lib/utils";
import type { ModuleSummary } from "@/server/dashboard";
import type { Pulse } from "@/server/pulse";

interface ServiceAnalytics {
  open: {
    id: string; caseNumber: string; subject: string; priority: string;
    status: string; ownerName: string | null; accountName: string | null;
    ageDays: number; overdue: boolean;
  }[];
  ageBands: { label: string; count: number; stale: boolean }[];
  byPriority: { priority: string; count: number }[];
  byOwner: { name: string; count: number; overdue: number }[];
  oldest: {
    id: string; caseNumber: string; subject: string;
    ageDays: number; ownerName: string | null; overdue: boolean;
  }[];
  openedLast30: number;
  resolvedLast30: number;
  arrivalRate: number | null;
  avgAgeDays: number;
}

/**
 * Support load, split by the things that change what you do about it.
 *
 * Four counts told you how many cases were open and nothing about their shape.
 * Whether twenty open cases is fine or a crisis depends on how old they are, who
 * they belong to, and whether they are arriving faster than they close.
 *
 * The arrival rate is the figure to read first: above 100% the queue is growing
 * no matter how hard anyone is working, and no amount of effort inside the team
 * fixes a queue that is filling faster than it drains.
 *
 * Every figure here is one you want falling, so every KPI inverts its arrow
 * colour — the opposite of the sales view, where the same rising arrow is good.
 */
export function ServiceView({
  summary,
  pulse,
  analytics,
}: {
  summary: ModuleSummary;
  pulse: Pulse;
  analytics: ServiceAnalytics;
}) {
  const maxBand = Math.max(...analytics.ageBands.map((b) => b.count), 1);
  const stale = analytics.ageBands
    .filter((b) => b.stale)
    .reduce((s, b) => s + b.count, 0);

  const attentionItems = [
    {
      id: "unassigned",
      count: summary.service.unassignedCases,
      title: "Cases with nobody assigned",
      detail: "Not being worked by anyone until someone owns them",
      href: "/cases",
      tone: "critical" as const,
    },
    {
      id: "breached",
      count: summary.service.breachedSla,
      title: "Cases that have breached their SLA",
      detail: "The promise made to the customer has already been missed",
      href: "/cases",
      tone: "critical" as const,
    },
    {
      id: "stale",
      count: stale,
      title: "Cases open longer than a week",
      detail: "Old cases rarely resolve themselves",
      href: "/cases",
      tone: "warning" as const,
    },
    {
      id: "critical",
      count: summary.service.criticalCases,
      title: "Cases marked critical",
      href: "/cases?priority=CRITICAL",
      tone: "warning" as const,
    },
  ].filter((i) => i.count > 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Open cases"
          value={String(summary.service.openCases)}
          sublabel={`Average age ${analytics.avgAgeDays} day${analytics.avgAgeDays === 1 ? "" : "s"}`}
          goodDirection="down"
          delta={pulse.deltas.casesOpened}
          series={pulse.casesOpened.values}
          module="service"
          href="/cases"
          emphasis
        />
        <Kpi
          label="Arrival vs clearance"
          value={
            analytics.arrivalRate === null
              ? "—"
              : `${formatNumber(analytics.arrivalRate, 0)}%`
          }
          sublabel={
            analytics.arrivalRate === null
              ? "Nothing resolved in 30 days"
              : analytics.arrivalRate > 100
                ? "Arriving faster than closing"
                : "Closing faster than arriving"
          }
          goodDirection="down"
          module="service"
        />
        <Kpi
          label="SLA breached"
          value={String(summary.service.breachedSla)}
          sublabel="Past the response or resolution promise"
          goodDirection="down"
          module="service"
          href="/cases"
        />
        <Kpi
          label="Unassigned"
          value={String(summary.service.unassignedCases)}
          sublabel={
            summary.service.unassignedCases > 0
              ? "Nobody is working these"
              : "Everything is owned"
          }
          goodDirection="down"
          module="service"
          href="/cases"
        />
      </div>

      {attentionItems.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
          <AttentionList items={attentionItems} />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------------------------------------- how old */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">How long cases have been open</h2>
          <div className="rounded-xl border bg-card p-4">
            <div className="space-y-2.5">
              {analytics.ageBands.map((b) => (
                <div key={b.label} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">{b.label}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.max(b.count > 0 ? 2 : 0, (b.count / maxBand) * 100)}%`,
                        // Fresh cases are normal; anything past a week is the
                        // part worth looking at, so only those wear the hue.
                        backgroundColor: b.stale
                          ? "var(--module-service)"
                          : "hsl(var(--muted-foreground) / 0.35)",
                      }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums">
                    {b.count || "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- whose queue */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">Load by person</h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            {analytics.byOwner.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No open cases.
              </p>
            ) : (
              <ul className="divide-y">
                {analytics.byOwner.slice(0, 6).map((o) => (
                  <li key={o.name} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{o.name}</span>
                    {o.overdue > 0 && (
                      <span className="shrink-0 text-xs text-red-600 dark:text-red-400">
                        {o.overdue} overdue
                      </span>
                    )}
                    <span className="w-8 shrink-0 text-right text-sm font-medium tabular-nums">
                      {o.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* ------------------------------------------------- what is going stale */}
      {analytics.oldest.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Oldest open cases</h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            <ul className="divide-y">
              {analytics.oldest.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className={cn(
                      "w-16 shrink-0 text-xs tabular-nums",
                      c.ageDays > 30
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {c.ageDays}d
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link href={`/cases/${c.id}`} className="block truncate text-sm hover:underline">
                      {c.subject}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.caseNumber}
                      {c.ownerName ? ` · ${c.ownerName}` : " · unassigned"}
                    </span>
                  </span>
                  {c.overdue && (
                    <span className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400">
                      SLA breached
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
