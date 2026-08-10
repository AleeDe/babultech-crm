import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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
      prisma.case.count({
        where: { deletedAt: null, status: { notIn: ["CLOSED", "CANCELLED", "RESOLVED"] } },
      }),
      prisma.project.count({ where: { deletedAt: null, status: "ACTIVE" } }),
      prisma.invoice.aggregate({
        where: {
          deletedAt: null,
          status: { notIn: ["DRAFT", "CANCELLED", "PAID", "WRITTEN_OFF"] },
          dueDate: { lt: new Date() },
        },
        _sum: { outstandingAmount: true },
        _count: true,
      }),
      prisma.partner.findMany({
        where: { deletedAt: null, status: "ACTIVE" },
        include: {
          _count: { select: { opportunities: true } },
          commissionRecords: {
            where: { deletedAt: null },
            select: { commissionAmount: true, status: true },
          },
        },
        take: 6,
      }),
      prisma.activity.findMany({
        where: { ownerUserId: user.id, status: "OPEN", deletedAt: null },
        orderBy: { dueAt: "asc" },
        take: 6,
      }),
    ]);

  const openStages = pipeline.filter(
    (p) => p.stage !== "CLOSED_WON" && p.stage !== "CLOSED_LOST",
  );
  const openPipelineTotal = openStages.reduce(
    (s, p) => s.plus(p.total),
    new Prisma.Decimal(0),
  );
  const wonTotal =
    pipeline.find((p) => p.stage === "CLOSED_WON")?.total ?? new Prisma.Decimal(0);
  const maxStage = openStages.reduce(
    (m, p) => (p.total.greaterThan(m) ? p.total : m),
    new Prisma.Decimal(1),
  );

  const partnersRanked = topPartners
    .map((p) => ({
      ...p,
      earned: p.commissionRecords.reduce(
        (s, r) => s.plus(r.commissionAmount),
        new Prisma.Decimal(0),
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
          sublabel={`${openStages.reduce((s, p) => s + p.count, 0)} live deals`}
          href="/opportunities"
        />
        <StatTile
          label="Closed won"
          value={formatCompactMoney(wonTotal)}
          sublabel={`${pipeline.find((p) => p.stage === "CLOSED_WON")?.count ?? 0} deals`}
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
                {openStages.map((s) => (
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
            ].map((row) => (
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
                  {partnersRanked.map((p) => (
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
                  {myActivities.map((a) => (
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
