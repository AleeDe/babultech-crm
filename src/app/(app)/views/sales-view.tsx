import Link from "next/link";
import { Kpi, AttentionList } from "@/components/dashboard-kit";
import { formatCompactMoney, formatNumber, humanize, cn } from "@/lib/utils";
import { toDecimal } from "@/lib/decimal";
import type { ModuleSummary } from "@/server/dashboard";
import type { Pulse } from "@/server/pulse";

interface SalesAnalytics {
  winRate: number | null;
  wonCount: number;
  lostCount: number;
  wonValue: number;
  lostValue: number;
  avgCycleDays: number | null;
  avgDealSize: number | null;
  leadConversionRate: number | null;
  leadsCreated: number;
  leadsConverted: number;
  lossReasons: { reason: string; count: number; value: number }[];
  byOwner: { name: string; open: number; openValue: number; won: number; wonValue: number }[];
  stalled: {
    id: string; name: string; accountName: string | null;
    ownerName: string | null; amount: number; daysOverdue: number;
  }[];
}

/**
 * Selling, deep enough to act on.
 *
 * A pipeline total says what is in play; it says nothing about whether any of it
 * moves. The questions this now answers are how often we win, how long it takes,
 * why we lose, who is carrying the number, and what has stopped moving — none of
 * which a snapshot of open value can show.
 *
 * Win rate and cycle time are over the last 90 days. A lifetime figure smooths
 * away exactly the change you would want to notice.
 */
export function SalesView({
  summary,
  pulse,
  pipeline,
  attention,
  analytics,
}: {
  summary: ModuleSummary;
  pulse: Pulse;
  pipeline: { stage: string; total: ReturnType<typeof toDecimal>; count: number }[];
  attention: { staleDeals: Record<string, any>[] };
  analytics: SalesAnalytics;
}) {
  const openStages = pipeline.filter(
    (p) => p.stage !== "CLOSED_WON" && p.stage !== "CLOSED_LOST",
  );
  const openTotal = openStages.reduce((s, p) => s.plus(p.total), toDecimal(0));
  const liveDeals = openStages.reduce((s, p) => s + p.count, 0);
  const maxStage = openStages.reduce(
    (m, p) => (p.total.greaterThan(m) ? p.total : m),
    toDecimal(1),
  );

  const attentionItems = [
    {
      id: "stalled",
      count: analytics.stalled.length,
      title: "Deals past their expected close date",
      detail: `${formatCompactMoney(analytics.stalled.reduce((s, d) => s + d.amount, 0))} sitting still`,
      href: "/opportunities",
      tone: "critical" as const,
    },
    {
      id: "follow-up",
      count: summary.sales.leadsToFollowUp,
      title: "Leads due a follow-up",
      detail: "A lead with no next step is how prospects go quiet",
      href: "/leads",
      tone: "warning" as const,
    },
    {
      id: "quotes",
      count: summary.sales.quotesAwaitingReply,
      title: "Quotes awaiting a customer reply",
      detail: `${formatCompactMoney(summary.sales.quoteValueOut)} out with customers`,
      href: "/quotations?status=SENT",
      tone: "warning" as const,
    },
  ].filter((i) => i.count > 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Open pipeline"
          value={formatCompactMoney(openTotal)}
          sublabel={`${liveDeals} live deal${liveDeals === 1 ? "" : "s"}`}
          delta={pulse.deltas.dealsCreated}
          series={pulse.dealsCreated.values}
          module="sales"
          href="/opportunities"
          emphasis
        />
        <Kpi
          label="Win rate"
          value={analytics.winRate === null ? "—" : `${formatNumber(analytics.winRate, 0)}%`}
          sublabel={
            analytics.winRate === null
              ? "No deals closed in 90 days"
              : `${analytics.wonCount} won · ${analytics.lostCount} lost`
          }
          module="sales"
        />
        <Kpi
          label="Average deal"
          value={analytics.avgDealSize === null ? "—" : formatCompactMoney(analytics.avgDealSize)}
          sublabel={
            analytics.avgCycleDays === null
              ? "No won deals yet"
              : `${analytics.avgCycleDays} days to close`
          }
          module="sales"
        />
        <Kpi
          label="Lead conversion"
          value={
            analytics.leadConversionRate === null
              ? "—"
              : `${formatNumber(analytics.leadConversionRate, 0)}%`
          }
          sublabel={`${analytics.leadsConverted} of ${analytics.leadsCreated} leads in 90 days`}
          module="sales"
          href="/leads"
        />
      </div>

      {attentionItems.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
          <AttentionList items={attentionItems} />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold">Pipeline by stage</h2>
          <div className="rounded-xl border bg-card p-4">
            {openStages.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No open deals. Convert a lead to start one.
              </p>
            ) : (
              <div className="space-y-2.5">
                {openStages.map((s) => {
                  const share = Number(s.total.dividedBy(maxStage).times(100));
                  return (
                    <Link
                      key={s.stage}
                      href={`/opportunities?stage=${s.stage}`}
                      className="group flex items-center gap-3 rounded px-1 py-0.5 transition-colors hover:bg-muted/50"
                    >
                      <span className="w-36 shrink-0 truncate text-xs text-muted-foreground">
                        {humanize(s.stage)}
                      </span>
                      <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${Math.max(2, share)}%`,
                            backgroundColor: "var(--module-sales)",
                          }}
                        />
                      </div>
                      <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums">
                        {formatCompactMoney(s.total)}
                      </span>
                      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {s.count}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Why deals are lost is the only field that says what to change. */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">Why we lose</h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            {analytics.lossReasons.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No deals lost in the last 90 days.
              </p>
            ) : (
              <ul className="divide-y">
                {analytics.lossReasons.slice(0, 6).map((r) => (
                  <li key={r.reason} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 truncate text-sm">{humanize(r.reason)}</span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-medium tabular-nums">{r.count}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {formatCompactMoney(r.value)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* ------------------------------------------- who is carrying the number */}
      {analytics.byOwner.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">By salesperson</h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Person</th>
                    <th className="px-3 py-2 text-right font-medium">Open</th>
                    <th className="px-3 py-2 text-right font-medium">Pipeline</th>
                    <th className="px-3 py-2 text-right font-medium">Won (90d)</th>
                    <th className="px-4 py-2 text-right font-medium">Won value</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {analytics.byOwner.map((o) => (
                    <tr key={o.name} className="transition-colors hover:bg-muted/40">
                      <td className="px-4 py-2.5">{o.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{o.open}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatCompactMoney(o.openValue)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{o.won}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {o.wonValue > 0 ? formatCompactMoney(o.wonValue) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------- what has stopped */}
      {analytics.stalled.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Stalled deals</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Past their expected close date. Either they move or they should be
            closed out - a pipeline full of these is a pipeline you cannot forecast
            from.
          </p>
          <div className="overflow-hidden rounded-xl border bg-card">
            <ul className="divide-y">
              {analytics.stalled.slice(0, 8).map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className={cn(
                      "w-20 shrink-0 text-xs tabular-nums",
                      d.daysOverdue > 30
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {d.daysOverdue}d late
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link
                      href={`/opportunities/${d.id}`}
                      className="block truncate text-sm hover:underline"
                    >
                      {d.name}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[d.accountName, d.ownerName].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatCompactMoney(d.amount)}
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
