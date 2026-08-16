import Link from "next/link";
import { toDecimal } from "@/lib/decimal";
import { supabaseServer } from "@/lib/supabase";
import { requireUser } from "@/lib/authz";
import { getPipelineByStage } from "@/server/opportunities";
import { getCommissionTotals } from "@/server/commissions";
import {
  Card, CardHeader, CardTitle, CardContent, PageHeader, StatTile,
  Badge, statusTone, Table, THead, TBody, TR, TH, TD, EmptyState,
} from "@/components/ui";
import { formatCompactMoney, formatMoney, formatDate, humanize } from "@/lib/utils";

export default async function DashboardPage() {
  const user = await requireUser();

  const [pipeline, commissions, openCases, activeProjects, overdueInvoices, topPartners, myActivities] =
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

  return (
    <>
      <PageHeader
        title={`Good to see you, ${user.fullName.split(" ")[0]}`}
        description="Pipeline, partner commissions and delivery load at a glance."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Open pipeline"
          value={formatCompactMoney(openPipelineTotal)}
          sublabel={`${openStages.reduce((s: any, p: Record<string, any>) => s + p.count, 0)} live deals`}
          href="/opportunities"
        />
        <StatTile
          label="Closed won"
          value={formatCompactMoney(wonTotal)}
          sublabel={`${pipeline.find((p: Record<string, any>) => p.stage === "CLOSED_WON")?.count ?? 0} deals`}
          tone="success"
          href="/opportunities?stage=CLOSED_WON"
        />
        <StatTile
          label="Commission payable"
          value={formatCompactMoney(commissions.payable.amount)}
          sublabel={`${commissions.payable.count} approved, awaiting payout`}
          tone={commissions.payable.count > 0 ? "warning" : "neutral"}
          href="/commissions"
        />
        <StatTile
          label="Overdue receivables"
          value={formatCompactMoney(overdueInvoices._sum.outstandingAmount ?? 0)}
          sublabel={`${overdueInvoices._count} invoices past due`}
          tone={overdueInvoices._count > 0 ? "danger" : "neutral"}
          href="/invoices"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pipeline by stage</CardTitle>
          </CardHeader>
          <CardContent>
            {openStages.length === 0 ? (
              <EmptyState title="No open deals yet" description="Convert a lead or create an opportunity to get started." />
            ) : (
              <div className="space-y-2.5">
                {openStages.map((s: Record<string, any>) => (
                  <div key={s.stage} className="flex items-center gap-3">
                    <span className="w-44 shrink-0 truncate text-sm">{humanize(s.stage)}</span>
                    <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded bg-primary/80"
                        style={{
                          width: `${Math.max(2, Number(s.total.dividedBy(maxStage).times(100)))}%`,
                        }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-sm tabular">
                      {formatCompactMoney(s.total)}
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular">
                      {s.count}
                    </span>
                  </div>
                ))}
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
