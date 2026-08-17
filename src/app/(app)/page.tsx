import Link from "next/link";
import {
  AlertTriangle, Target, Receipt, FolderKanban, LifeBuoy, Handshake,
} from "lucide-react";
import { toDecimal } from "@/lib/decimal";
import { supabaseServer } from "@/lib/supabase";
import { requireUser } from "@/lib/authz";
import { getPipelineByStage } from "@/server/opportunities";
import { getCommissionTotals } from "@/server/commissions";
import { getModuleSummary, getAttentionItems } from "@/server/dashboard";
import { getPayablesSummary } from "@/server/payables";
import { getPendingApprovals } from "@/server/approvals";
import { getPulse, getRecentChanges } from "@/server/pulse";
import { ModuleSummary } from "./module-summary";
import { PulseTile } from "./pulse-tile";
import { LiveIndicator, LiveClock, PulseDot } from "@/components/live-indicator";
import { ActivityStream } from "@/components/activity-stream";
import {
  Card, CardHeader, CardTitle, CardContent, PageHeader, StatTile,
  Badge, statusTone, Table, THead, TBody, TR, TH, TD, EmptyState,
} from "@/components/ui";
import { formatCompactMoney, formatMoney, formatDate, humanize } from "@/lib/utils";

/**
 * The dashboard refreshes itself over a realtime socket, so a cached render
 * would be showing figures the socket has already announced as stale.
 */
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();

  const [
    pipeline, commissions, openCases, activeProjects, overdueInvoices, topPartners, myActivities,
    summary, attentionData, payables, approvals, pulse, recentChanges,
  ] =
    await Promise.all([
      getPipelineByStage(),
      getCommissionTotals(),
      (async () => {
        const db = await supabaseServer();
        const { count } = await db
          .from("support_case")
          .select("id", { count: "exact", head: true })
          .is("deletedAt", null)
          .not("status", "in", '("CLOSED","CANCELLED","RESOLVED")');
        return count ?? 0;
      })(),
      (async () => {
        const db = await supabaseServer();
        const { count } = await db
          .from("project")
          .select("id", { count: "exact", head: true })
          .is("deletedAt", null)
          .eq("status", "ACTIVE");
        return count ?? 0;
      })(),
      // PostgREST has no aggregate, so the overdue rows are fetched and summed.
      // The dueDate cut-off is passed as a date string, which is what the
      // column is — comparing in JS against an ISO string would be the trap
      // this migration keeps hitting.
      (async () => {
        const db = await supabaseServer();
        const { data } = await db
          .from("invoice")
          .select("outstandingAmount")
          .is("deletedAt", null)
          .not("status", "in", '("DRAFT","CANCELLED","PAID","WRITTEN_OFF")')
          .lt("dueDate", new Date().toISOString().slice(0, 10));
        const rows = data ?? [];
        return {
          _count: rows.length,
          _sum: {
            outstandingAmount: rows.reduce(
              (sum, r) => sum.plus(toDecimal(r.outstandingAmount)),
              toDecimal(0),
            ),
          },
        };
      })(),
      (async () => {
        const db = await supabaseServer();
        const { data } = await db
          .from("partner")
          .select(
            `*,
             opportunities:opportunity_partner ( count ),
             commissionRecords:commission_record ( commissionAmount, status, deletedAt )`,
          )
          .is("deletedAt", null)
          .eq("status", "ACTIVE")
          .limit(6);

        // Prisma filtered the embedded records in the query; PostgREST returns
        // them all, so the soft-delete filter is applied here.
        return (data ?? []).map((p: Record<string, any>) => ({
          ...p,
          _count: {
            opportunities:
              (p.opportunities as { count: number }[] | undefined)?.[0]?.count ?? 0,
          },
          commissionRecords: (
            (p.commissionRecords ?? []) as { deletedAt: string | null }[]
          ).filter((r: Record<string, any>) => !r.deletedAt),
        }));
      })(),
      (async () => {
        const db = await supabaseServer();
        const { data } = await db
          .from("activity")
          .select("*")
          .eq("ownerUserId", user.id)
          .eq("status", "OPEN")
          .is("deletedAt", null)
          .order("dueAt")
          .limit(6);
        return data ?? [];
      })(),
      getModuleSummary(),
      getAttentionItems(),
      getPayablesSummary(),
      // The queue needs at least one approve permission. A reader without any
      // gets an empty list rather than a page that fails to load.
      getPendingApprovals().catch(() => ({
        items: [] as Awaited<ReturnType<typeof getPendingApprovals>>["items"],
        byKind: {},
        totalValue: "0",
        oldestDays: 0,
      })),
      getPulse(30),
      getRecentChanges(25),
    ]);

  const openStages = pipeline.filter(
    (p) => p.stage !== "CLOSED_WON" && p.stage !== "CLOSED_LOST",
  );
  const openPipelineTotal = openStages.reduce(
    (s, p) => s.plus(p.total),
    toDecimal(0),
  );
  const wonTotal =
    pipeline.find((p: Record<string, any>) => p.stage === "CLOSED_WON")?.total ?? toDecimal(0);
  const maxStage = openStages.reduce(
    (m, p) => (p.total.greaterThan(m) ? p.total : m),
    toDecimal(1),
  );

  // Only the categories that actually have something in them, so an empty
  // strip disappears rather than reading as four reassuring zeros.
  const attention = [
    {
      count: attentionData.overdueInvoices.length,
      title: "Invoices past their due date",
      detail: attentionData.overdueInvoices
        .slice(0, 3)
        .map((i: Record<string, any>) => `${i.invoiceNumber} — ${i.account?.name ?? "unknown"}`)
        .join(" · "),
      href: "/invoices",
      tone: "danger" as const,
    },
    {
      count: attentionData.breachedCases.length,
      title: "Cases breaching SLA or marked critical",
      detail: attentionData.breachedCases
        .slice(0, 3)
        .map((c: Record<string, any>) => `${c.caseNumber} — ${c.subject}`)
        .join(" · "),
      href: "/cases",
      tone: "danger" as const,
    },
    {
      count: attentionData.staleDeals.length,
      title: "Deals past their expected close date",
      detail: attentionData.staleDeals
        .slice(0, 3)
        .map((o: Record<string, any>) => `${o.name} — ${o.account?.name ?? "unknown"}`)
        .join(" · "),
      href: "/opportunities",
      tone: "warning" as const,
    },
    {
      count: attentionData.expiringAgreements.length,
      title: "Partner agreements expiring within 60 days",
      detail: attentionData.expiringAgreements
        .slice(0, 3)
        .map((p: Record<string, any>) => `${p.displayName} — ${formatDate(p.agreementExpiryDate)}`)
        .join(" · "),
      href: "/partners",
      tone: "warning" as const,
    },
    {
      count: approvals.items.filter((i) => !i.blockedReason).length,
      title: "Waiting on your approval",
      detail: approvals.items
        .filter((i) => !i.blockedReason)
        .slice(0, 3)
        .map((i) => `${i.reference} — ${i.title}`)
        .join(" · "),
      href: "/approvals",
      tone: "warning" as const,
    },
  ].filter((item) => item.count > 0);

  const partnersRanked = topPartners
    .map((p: Record<string, any>) => ({
      ...p,
      earned: p.commissionRecords.reduce(
        (s: ReturnType<typeof toDecimal>, r: Record<string, any>) =>
          s.plus(toDecimal(r.commissionAmount)),
        toDecimal(0),
      ),
    }))
    .sort((a, b) => b.earned.comparedTo(a.earned));

  const liveDeals = openStages.reduce(
    (s: number, p: Record<string, any>) => s + p.count,
    0,
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title={`Good to see you, ${user.fullName.split(" ")[0]}`}
          description="Pipeline, cash and delivery load — updating as it happens."
        />
        <div className="mb-4 flex items-center gap-3">
          <LiveClock />
          <LiveIndicator />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PulseTile
          label="Open pipeline"
          raw={Number(openPipelineTotal)}
          sublabel={`${liveDeals} live deals`}
          series={pulse.dealsCreated.values}
          delta={pulse.deltas.dealsCreated}
          href="/opportunities"
          icon="Target"
          tone="primary"
        />
        <PulseTile
          label="Won this month"
          raw={Number(summary.sales.wonValueThisMonth)}
          sublabel={`${summary.sales.wonThisMonth} deals closed`}
          series={pulse.wonValue.values}
          delta={pulse.deltas.wonValue}
          href="/opportunities?stage=CLOSED_WON"
          icon="TrendingUp"
          tone="success"
        />
        <PulseTile
          label="Collected this month"
          raw={Number(summary.finance.collectedThisMonth)}
          sublabel={`${formatCompactMoney(summary.finance.outstanding)} still outstanding`}
          series={pulse.collected.values}
          delta={pulse.deltas.collected}
          href="/payments"
          icon="Banknote"
          tone="success"
        />
        <PulseTile
          label="Overdue receivables"
          raw={Number(overdueInvoices._sum.outstandingAmount ?? 0)}
          sublabel={`${overdueInvoices._count} invoices past due`}
          // Cash collected, inverted in meaning rather than in data: money
          // arriving is what clears this figure, so the same series is the
          // honest trend for it. A sparkline of unrelated numbers under a
          // headline is worse than no sparkline.
          series={pulse.collected.values}
          delta={pulse.deltas.collected}
          href="/invoices"
          icon="Receipt"
          tone={overdueInvoices._count > 0 ? "danger" : "muted"}
        />
      </div>

      {attention.length > 0 && (
        <Card className="mt-6 border-amber-300/60 dark:border-amber-800/60">
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
            <CardTitle className="text-base">Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="divide-y border-t">
              {attention.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/50"
                >
                  <span className="mt-0.5 shrink-0">
                    <Badge tone={item.tone}>{item.count}</Badge>
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{item.title}</span>
                    <span className="block text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <h2 className="mb-3 mt-8 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        <PulseDot />
        Live summary
      </h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {summary.visible.sales && (
          <ModuleSummary
            title="Sales"
            icon={Target}
            href="/opportunities"
            headline={{ label: "in open pipeline", value: formatCompactMoney(summary.sales.openValue) }}
            rows={[
              { label: "Open deals", value: String(summary.sales.openDeals), href: "/opportunities" },
              { label: "Won this month", value: `${summary.sales.wonThisMonth} · ${formatCompactMoney(summary.sales.wonValueThisMonth)}`, href: "/opportunities?stage=CLOSED_WON" },
              { label: "Quotes awaiting reply", value: `${summary.sales.quotesAwaitingReply} · ${formatCompactMoney(summary.sales.quoteValueOut)}`, href: "/quotations?status=SENT" },
              { label: "New leads", value: String(summary.sales.newLeads), href: "/leads?status=NEW" },
              { label: "Follow-ups due", value: String(summary.sales.leadsToFollowUp), href: "/leads", alert: summary.sales.leadsToFollowUp > 0 },
            ]}
          />
        )}

        {summary.visible.finance && (
          <ModuleSummary
            title="Finance"
            icon={Receipt}
            href="/invoices"
            headline={{ label: "outstanding", value: formatCompactMoney(summary.finance.outstanding) }}
            rows={[
              { label: "Overdue", value: `${summary.finance.overdueCount} · ${formatCompactMoney(summary.finance.overdue)}`, href: "/invoices", alert: summary.finance.overdueCount > 0 },
              { label: "Collected this month", value: formatCompactMoney(summary.finance.collectedThisMonth), href: "/payments" },
              { label: "Unallocated payments", value: formatCompactMoney(summary.finance.unallocatedPayments), href: "/payments", alert: Number(summary.finance.unallocatedPayments) > 0 },
              { label: "Draft invoices", value: String(summary.finance.draftInvoices), href: "/invoices" },
              // Payables belong here too: receivables alone say what was earned,
              // not what it cost.
              { label: "Owed to suppliers", value: formatCompactMoney(payables.billsOutstanding), href: "/vendor-bills" },
              {
                label: "Expenses to approve",
                value: String(payables.expensesAwaitingApprovalCount),
                href: "/expenses?approvalStatus=SUBMITTED",
                alert: payables.expensesAwaitingApprovalCount > 0,
              },
            ]}
          />
        )}

        {summary.visible.delivery && (
          <ModuleSummary
            title="Delivery"
            icon={FolderKanban}
            href="/projects"
            headline={{ label: "active projects", value: String(summary.delivery.activeProjects) }}
            rows={[
              { label: "At risk", value: String(summary.delivery.atRiskProjects), href: "/projects", alert: summary.delivery.atRiskProjects > 0 },
              { label: "Milestones due in 14 days", value: String(summary.delivery.milestonesDueSoon), href: "/projects" },
              { label: "Overdue tasks", value: String(summary.delivery.overdueTasks), href: "/projects", alert: summary.delivery.overdueTasks > 0 },
              { label: "Hours awaiting approval", value: summary.delivery.hoursAwaitingApproval, href: "/timesheets/approvals" },
            ]}
          />
        )}

        {summary.visible.service && (
          <ModuleSummary
            title="Support"
            icon={LifeBuoy}
            href="/cases"
            headline={{ label: "open cases", value: String(summary.service.openCases) }}
            rows={[
              { label: "Critical", value: String(summary.service.criticalCases), href: "/cases?priority=CRITICAL", alert: summary.service.criticalCases > 0 },
              { label: "SLA breached", value: String(summary.service.breachedSla), href: "/cases", alert: summary.service.breachedSla > 0 },
              { label: "Unassigned", value: String(summary.service.unassignedCases), href: "/cases", alert: summary.service.unassignedCases > 0 },
            ]}
          />
        )}

        {summary.visible.partners && (
          <ModuleSummary
            title="Partners"
            icon={Handshake}
            href="/partners"
            headline={{ label: "commission payable", value: formatCompactMoney(summary.partners.commissionPayable) }}
            rows={[
              { label: "Active partners", value: String(summary.partners.activePartners), href: "/partners" },
              { label: "Awaiting approval", value: String(summary.partners.commissionPendingApproval), href: "/commissions", alert: summary.partners.commissionPendingApproval > 0 },
              { label: "Agreements expiring in 60 days", value: String(summary.partners.agreementsExpiringSoon), href: "/partners", alert: summary.partners.agreementsExpiringSoon > 0 },
            ]}
          />
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center gap-2">
            <CardTitle>Pipeline by stage</CardTitle>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {formatCompactMoney(openPipelineTotal)} / {liveDeals} deals
            </span>
          </CardHeader>
          <CardContent>
            {openStages.length === 0 ? (
              <EmptyState title="No open deals yet" description="Convert a lead or create an opportunity to get started." />
            ) : (
              <div className="space-y-2.5">
                {openStages.map((s: Record<string, any>) => {
                  const share = Number(s.total.dividedBy(maxStage).times(100));
                  return (
                    <Link
                      key={s.stage}
                      href={`/opportunities?stage=${s.stage}`}
                      className="group flex items-center gap-3 rounded px-1 py-0.5 -mx-1 transition-colors hover:bg-muted/50"
                    >
                      <span className="w-32 shrink-0 truncate font-mono text-[11px] uppercase tracking-wider text-muted-foreground sm:w-44">
                        {humanize(s.stage)}
                      </span>
                      <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full rounded bg-gradient-to-r from-cyan-500/70 to-cyan-400 transition-all duration-500 group-hover:from-cyan-500 group-hover:to-cyan-300"
                          style={{ width: `${Math.max(2, share)}%` }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums sm:w-28">
                        {formatCompactMoney(s.total)}
                      </span>
                      <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground sm:w-10">
                        {s.count}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commission ledger</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Accrued", data: commissions.accrued, tone: "info" as const },
              { label: "Pending approval", data: commissions.pendingApproval, tone: "warning" as const },
              { label: "Payable", data: commissions.payable, tone: "warning" as const },
              { label: "Paid", data: commissions.paid, tone: "success" as const },
            ].map((row: Record<string, any>) => (
              <div key={row.label} className="flex items-center justify-between border-b pb-2 last:border-0">
                <div>
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.data.count} records</p>
                </div>
                <span className="text-sm font-semibold tabular">
                  {formatMoney(row.data.amount)}
                </span>
              </div>
            ))}
            <Link href="/commissions" className="block pt-1 text-sm text-primary hover:underline">
              Open the commission ledger →
            </Link>
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        <PulseDot />
        Change stream
        <span className="font-sans normal-case tracking-normal opacity-70">
          — every edit anyone makes, as it lands
        </span>
      </h2>
      <ActivityStream initial={recentChanges} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top partners by commission earned</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {partnersRanked.length === 0 ? (
              <div className="px-5">
                <EmptyState
                  title="No partners yet"
                  description="Add a reseller or an individual referrer to start tracking partner-sourced revenue."
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Partner</TH>
                    <TH>Type</TH>
                    <TH className="text-right">Deals</TH>
                    <TH className="text-right">Earned</TH>
                  </TR>
                </THead>
                <TBody>
                  {partnersRanked.map((p: Record<string, any>) => (
                    <TR key={p.id}>
                      <TD>
                        <Link href={`/partners/${p.id}`} className="font-medium hover:underline">
                          {p.displayName}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {p.kind === "INDIVIDUAL" ? "Individual" : "Company"}
                        </p>
                      </TD>
                      <TD>
                        <Badge tone="neutral">{humanize(p.partnerType)}</Badge>
                      </TD>
                      <TD className="text-right tabular">{p._count.opportunities}</TD>
                      <TD className="text-right font-medium tabular">{formatMoney(p.earned)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile label="Open support cases" value={String(openCases)} href="/cases" tone={openCases > 0 ? "info" : "neutral"} />
            <StatTile label="Active projects" value={String(activeProjects)} href="/projects" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>My open activities</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {myActivities.length === 0 ? (
                <div className="px-5 pb-2 text-sm text-muted-foreground">Nothing scheduled. Enjoy it.</div>
              ) : (
                <ul className="divide-y">
                  {myActivities.map((a: Record<string, any>) => (
                    <li key={a.id} className="flex items-center justify-between px-5 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {humanize(a.activityType)} · due {formatDate(a.dueAt)}
                        </p>
                      </div>
                      <Badge tone={statusTone(a.priority)}>{humanize(a.priority)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
