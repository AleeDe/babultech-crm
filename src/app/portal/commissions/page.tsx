import Link from "next/link";
import { requireUser } from "@/lib/authz";
import { getPortalCommissions } from "@/server/portal";
import {
  PageHeader, Card, CardContent, Badge, statusTone, EmptyState, StatTile, Select, Button,
} from "@/components/ui";
import { formatMoneyPlain as formatMoney, formatDate, formatPercent, humanize, formatMoneyTotal } from "@/lib/utils";
import { PortalCommissionActions } from "./commission-actions";

const STATUSES = ["IN_PROGRESS", "PAID", "REJECTED"];

export default async function PortalCommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  // Commission is for the partner's Admins; the database returns none to a User.
  const me = await requireUser();
  if (me.portalRole !== "ADMIN") {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="font-medium">Commission is for your company's portal Admins</p>
        <p className="mt-1 text-sm text-muted-foreground">Ask one of them if you need to know what a deal has earned.</p>
      </div>
    );
  }
  const { status } = await searchParams;
  const records = await getPortalCommissions(status);

  const currency = records[0]?.currencyCode ?? "PKR";
  const sum = (rows: typeof records) => rows.reduce((s, r) => s + Number(r.partnerAmount), 0);
  const won = (r: (typeof records)[number]) => r.opportunity?.stage === "CLOSED_WON";
  const inProgress = records.filter((r) => r.status === "IN_PROGRESS");

  return (
    <>
      <PageHeader
        title="Commission"
        description="One record for each of your deals: what it is worth to you, and when it is paid."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Owed to you"
          value={formatMoneyTotal(sum(inProgress.filter(won)), currency)}
          sublabel="On won deals, not yet paid"
          tone="warning"
        />
        <StatTile
          label="In your pipeline"
          value={formatMoneyTotal(sum(inProgress.filter((r) => !won(r))), currency)}
          sublabel="On open deals, if they are won"
          tone="info"
        />
        <StatTile
          label="Paid to you"
          value={formatMoneyTotal(sum(records.filter((r) => r.status === "PAID")), currency)}
          sublabel="Net of withholding tax"
          tone="success"
        />
      </div>

      <Card className="mt-6">
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <Select name="status" defaultValue={status ?? ""} className="w-56" aria-label="Status">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
          <Button type="submit" variant="outline">Filter</Button>
        </form>

        {records.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No commission yet"
              description="Every deal credited to you gets a commission record the day it is created."
            />
          </div>
        ) : (
          <ul className="divide-y">
            {records.map((r) => {
              const open = r.status === "IN_PROGRESS";
              return (
                <li key={r.id} className="p-4">
                  <CardContent className="space-y-3 p-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{r.opportunity?.name}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono">{r.commissionNumber}</span>
                          {r.opportunity?.account && (
                            <>
                              {" · "}
                              <Link href={`/portal/customers/${r.opportunity.account.id}`} className="hover:underline">
                                {r.opportunity.account.name}
                              </Link>
                            </>
                          )}
                          {r.opportunity && ` · ${humanize(r.opportunity.stage)}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>
                        {r.requestStatus === "PENDING" && <Badge tone="warning">Rate request waiting</Badge>}
                      </div>
                    </div>

                    <dl className="grid gap-3 text-sm sm:grid-cols-5">
                      <Figure label="Deal amount">{formatMoney(r.baseAmount, r.currencyCode)}</Figure>
                      <Figure label="Your rate">{formatPercent(r.commissionPercent, 2)}</Figure>
                      <Figure label="Commission">{formatMoney(r.commissionAmount, r.currencyCode)}</Figure>
                      <Figure label="Withholding tax">{formatMoney(r.withholdingAmount, r.currencyCode)}</Figure>
                      <Figure label="You are paid">
                        <span className="font-semibold">{formatMoney(r.partnerAmount, r.currencyCode)}</span>
                      </Figure>
                    </dl>

                    <p className="text-sm text-muted-foreground">
                      {r.status === "PAID" && r.paymentDate && `Paid on ${formatDate(r.paymentDate)}.`}
                      {r.status === "REJECTED" && `Not paid: ${r.rejectedReason ?? "rejected"}.`}
                      {open && (r.paymentDate
                        ? `Payment date ${formatDate(r.paymentDate)}.`
                        : "The amount follows the deal until it is won; the payment date is set then.")}
                    </p>

                    {r.requestStatus && (
                      <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                        {r.requestStatus === "PENDING"
                          ? `You asked for ${Number(r.requestedPercent)}%${r.requestedAt ? ` on ${formatDate(r.requestedAt)}` : ""}. BabulTech will answer it.`
                          : r.requestStatus === "APPROVED"
                            ? `Your request for ${Number(r.requestedPercent)}% was approved${r.requestDecisionReason ? `: ${r.requestDecisionReason}` : "."}`
                            : `Your request for ${Number(r.requestedPercent)}% was declined: ${r.requestDecisionReason ?? ""}`}
                      </p>
                    )}

                    <PortalCommissionActions
                      id={r.id}
                      currentPercent={String(r.commissionPercent)}
                      canRequest={open && r.requestStatus !== "PENDING"}
                      canMarkPaid={open && r.opportunity?.stage === "CLOSED_WON"}
                    />
                  </CardContent>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 tabular">{children}</dd>
    </div>
  );
}
