import Link from "next/link";
import { Kpi, AttentionList } from "@/components/dashboard-kit";
import { formatCompactMoney, formatNumber, humanize, cn } from "@/lib/utils";

interface PartnerRow {
  id: string;
  name: string;
  partnerNumber: string;
  tier: string;
  status: string;
  dealsWon: number;
  dealsOpen: number;
  revenueSourced: number;
  pipelineSourced: number;
  earned: number;
  payable: number;
  paid: number;
  pending: number;
  daysToExpiry: number | null;
  blocked: boolean;
}

interface PartnerAnalytics {
  rows: PartnerRow[];
  totals: {
    activePartners: number;
    blockedPartners: number;
    revenueSourced: number;
    pipelineSourced: number;
    earned: number;
    payable: number;
    pending: number;
    paid: number;
  };
  expiringSoon: PartnerRow[];
}

/**
 * What partners bring in, and what they are owed — per partner, not in total.
 *
 * The ledger showed four totals, which says how much is outstanding and nothing
 * about who earned it or who is actually producing. A partner programme is
 * managed one partner at a time: the question is always which of them to invest
 * in and which to have a conversation with.
 *
 * Revenue sourced is deliberately shown beside commission earned. A partner who
 * has brought in ten times what they cost is a different proposition from one
 * whose commission is most of the margin on their deals, and only the pair
 * together shows which is which.
 */
export function PartnersView({
  analytics,
}: {
  analytics: PartnerAnalytics;
}) {
  const { rows, totals, expiringSoon } = analytics;
  const producing = rows.filter((r) => r.earned > 0 || r.dealsOpen > 0);

  const attentionItems = [
    {
      id: "blocked",
      count: totals.blockedPartners,
      title: "Partners who cannot currently earn",
      detail: "Inactive, or their agreement has lapsed - commission stops silently",
      href: "/partners",
      tone: "critical" as const,
    },
    {
      id: "expiring",
      count: expiringSoon.length,
      title: "Agreements expiring within 60 days",
      detail: expiringSoon
        .slice(0, 3)
        .map((p) => `${p.name} (${p.daysToExpiry}d)`)
        .join(" · "),
      href: "/partners",
      tone: "warning" as const,
    },
    {
      id: "pending",
      count: totals.pending > 0 ? 1 : 0,
      title: "Commission waiting on approval",
      detail: `${formatCompactMoney(totals.pending)} cannot be paid out until approved`,
      href: "/commissions",
      tone: "warning" as const,
    },
  ].filter((i) => i.count > 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Revenue sourced"
          value={formatCompactMoney(totals.revenueSourced)}
          sublabel={`${formatCompactMoney(totals.pipelineSourced)} more in pipeline`}
          module="partners"
          emphasis
        />
        <Kpi
          label="Commission payable"
          value={formatCompactMoney(totals.payable)}
          sublabel="Approved and owed"
          module="partners"
          href="/commissions"
        />
        <Kpi
          label="Awaiting approval"
          value={formatCompactMoney(totals.pending)}
          sublabel="Blocked until someone signs off"
          goodDirection="down"
          module="partners"
          href="/commissions"
        />
        <Kpi
          label="Active partners"
          value={String(totals.activePartners)}
          sublabel={
            totals.blockedPartners > 0
              ? `${totals.blockedPartners} cannot earn`
              : "All able to earn"
          }
          module="partners"
          href="/partners"
        />
      </div>

      {attentionItems.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
          <AttentionList items={attentionItems} />
        </section>
      )}

      {/* ------------------------------------------------- the partner table */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Every partner</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          Revenue sourced beside commission earned: the pair is what shows whether
          a partner is worth what they cost.
        </p>
        <div className="overflow-hidden rounded-xl border bg-card">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No partners yet. Add a reseller or referrer to start tracking
              partner-sourced revenue.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Partner</th>
                    <th className="px-3 py-2 text-right font-medium">Won</th>
                    <th className="px-3 py-2 text-right font-medium">Sourced</th>
                    <th className="px-3 py-2 text-right font-medium">Pipeline</th>
                    <th className="px-3 py-2 text-right font-medium">Earned</th>
                    <th className="px-4 py-2 text-right font-medium">Payable</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/partners/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {/* Blocked is stated in words: a partner who cannot
                              earn is the most important thing on this row, and
                              a colour alone would not carry it. */}
                          {p.blocked ? (
                            <span className="text-red-600 dark:text-red-400">
                              Cannot earn
                            </span>
                          ) : (
                            humanize(p.tier)
                          )}
                          {" · "}
                          {p.partnerNumber}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {p.dealsWon || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {p.revenueSourced > 0 ? formatCompactMoney(p.revenueSourced) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {p.pipelineSourced > 0 ? formatCompactMoney(p.pipelineSourced) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {p.earned > 0 ? formatCompactMoney(p.earned) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {p.payable > 0 ? formatCompactMoney(p.payable) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------- the commission ledger */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Commission ledger</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          Shown as four states rather than one total: earned and approved mean very
          different things, and a single figure covering both hides where the
          bottleneck is.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Awaiting approval", value: totals.pending, note: "Earned, not yet signed off" },
            { label: "Payable", value: totals.payable, note: "Approved and due" },
            { label: "Paid", value: totals.paid, note: "Already sent" },
            { label: "Earned all time", value: totals.earned, note: "Every state combined" },
          ].map((row) => (
            <div key={row.label} className="rounded-xl border bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {row.label}
              </p>
              <p className="mt-1.5 text-xl font-semibold tabular-nums">
                {formatCompactMoney(row.value)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{row.note}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
