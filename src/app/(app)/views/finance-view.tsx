import Link from "next/link";
import { Kpi, AttentionList } from "@/components/dashboard-kit";
import { formatCompactMoney, formatDate, formatNumber, cn } from "@/lib/utils";
import type { ModuleSummary } from "@/server/dashboard";
import type { Pulse } from "@/server/pulse";

interface FinanceAnalytics {
  buckets: { label: string; count: number; value: number; overdue: boolean }[];
  totalOutstanding: number;
  totalOverdue: number;
  byCustomer: { id: string | null; name: string; value: number; count: number; worstDays: number }[];
  worstInvoices: {
    id: string; invoiceNumber: string; accountName: string;
    outstanding: number; dueDate: string; daysOverdue: number;
  }[];
  avgDaysToPay: number | null;
  paidCount: number;
}

/**
 * Receivables, aged — and what it takes to actually get paid.
 *
 * "Overdue: 400,000" covers a bill a week late and one six months gone, which are
 * entirely different problems. The ageing ladder is the standard finance view
 * because the further right the money sits, the less of it comes back, and the
 * bucket a debt is in decides what you do about it.
 *
 * Days-to-pay sits beside it because the two together tell the real story: a
 * business can have very little overdue and still be starved of cash if every
 * customer takes ninety days.
 */
export function FinanceView({
  summary,
  pulse,
  payables,
  analytics,
}: {
  summary: ModuleSummary;
  pulse: Pulse;
  payables: {
    billsOutstanding: string;
    billsOverdue: string;
    billsOverdueCount: number;
    expensesAwaitingApproval: string;
    expensesAwaitingApprovalCount: number;
  };
  analytics: FinanceAnalytics;
}) {
  const maxBucket = Math.max(...analytics.buckets.map((b) => b.value), 1);
  const over90 = analytics.buckets.find((b) => b.label === "Over 90 days");

  const attentionItems = [
    {
      id: "over90",
      count: over90?.count ?? 0,
      title: "Invoices over 90 days past due",
      detail: `${formatCompactMoney(over90?.value ?? 0)} - the least likely to ever arrive`,
      href: "/invoices",
      tone: "critical" as const,
    },
    {
      id: "unallocated",
      count: Number(summary.finance.unallocatedPayments) > 0 ? 1 : 0,
      title: "Payments received but not applied to an invoice",
      detail: `${formatCompactMoney(summary.finance.unallocatedPayments)} sitting unallocated`,
      href: "/payments",
      tone: "warning" as const,
    },
    {
      id: "bills",
      count: payables.billsOverdueCount,
      title: "Supplier bills past their due date",
      detail: `${formatCompactMoney(payables.billsOverdue)} owed`,
      href: "/vendor-bills",
      tone: "warning" as const,
    },
    {
      id: "expenses",
      count: payables.expensesAwaitingApprovalCount,
      title: "Expense claims waiting on approval",
      href: "/expenses?approvalStatus=SUBMITTED",
      tone: "warning" as const,
    },
    {
      id: "drafts",
      count: summary.finance.draftInvoices,
      title: "Draft invoices not yet issued",
      detail: "Nothing can be collected until an invoice goes out",
      href: "/invoices",
      tone: "warning" as const,
    },
  ].filter((i) => i.count > 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Outstanding"
          value={formatCompactMoney(analytics.totalOutstanding)}
          sublabel="Invoiced and not yet paid"
          module="finance"
          href="/invoices"
          emphasis
        />
        <Kpi
          label="Overdue"
          value={formatCompactMoney(analytics.totalOverdue)}
          sublabel={
            analytics.totalOutstanding > 0
              ? `${formatNumber((analytics.totalOverdue / analytics.totalOutstanding) * 100, 0)}% of the book`
              : "Nothing outstanding"
          }
          goodDirection="down"
          module="finance"
          href="/invoices"
        />
        <Kpi
          label="Collected this month"
          value={formatCompactMoney(summary.finance.collectedThisMonth)}
          sublabel="Money actually received"
          delta={pulse.deltas.collected}
          series={pulse.collected.values}
          module="finance"
          href="/payments"
        />
        <Kpi
          label="Average days to pay"
          value={analytics.avgDaysToPay === null ? "—" : String(analytics.avgDaysToPay)}
          sublabel={
            analytics.avgDaysToPay === null
              ? "Nothing paid in 90 days"
              : `Across ${analytics.paidCount} paid invoice${analytics.paidCount === 1 ? "" : "s"}`
          }
          goodDirection="down"
          module="finance"
        />
      </div>

      {attentionItems.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
          <AttentionList items={attentionItems} />
        </section>
      )}

      {/* --------------------------------------------------- the ageing ladder */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Receivables ageing</h2>
        <div className="rounded-xl border bg-card p-4">
          <div className="space-y-2.5">
            {analytics.buckets.map((b) => {
              const share = (b.value / maxBucket) * 100;
              return (
                <div key={b.label} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{b.label}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.max(b.value > 0 ? 2 : 0, share)}%`,
                        // Current money is healthy and must not wear the same
                        // colour as debt that is months late.
                        backgroundColor: b.overdue
                          ? "var(--module-finance)"
                          : "hsl(var(--muted-foreground) / 0.35)",
                      }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums">
                    {b.value > 0 ? formatCompactMoney(b.value) : "—"}
                  </span>
                  <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {b.count || ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------------------------------ who owes the most */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">Who owes the most</h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            {analytics.byCustomer.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing outstanding.
              </p>
            ) : (
              <ul className="divide-y">
                {analytics.byCustomer.slice(0, 6).map((c) => (
                  <li key={c.name} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{c.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {c.count} invoice{c.count === 1 ? "" : "s"}
                        {c.worstDays > 0 && ` · oldest ${c.worstDays} days late`}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {formatCompactMoney(c.value)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ------------------------------------------------ the worst offenders */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">Oldest unpaid invoices</h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            {analytics.worstInvoices.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing overdue. Everything is either paid or still within terms.
              </p>
            ) : (
              <ul className="divide-y">
                {analytics.worstInvoices.slice(0, 6).map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className={cn(
                        "w-20 shrink-0 text-xs tabular-nums",
                        i.daysOverdue > 90
                          ? "font-medium text-red-600 dark:text-red-400"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {i.daysOverdue}d late
                    </span>
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/invoices/${i.id}`}
                        className="block truncate text-sm hover:underline"
                      >
                        {i.accountName}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {i.invoiceNumber} · due {formatDate(i.dueDate)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {formatCompactMoney(i.outstanding)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
