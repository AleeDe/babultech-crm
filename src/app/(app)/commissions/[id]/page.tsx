import Link from "next/link";
import { notFound } from "next/navigation";
import { getPartnerCommission } from "@/server/partner-commissions";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  StatTile, DetailRow, Alert, Forbidden,
} from "@/components/ui";
import { formatMoney, formatDate, formatDateTime, formatPercent, humanize } from "@/lib/utils";
import { CommissionActions, RateRequestDecision } from "./commission-actions";

/** What each audited field is called on this page. */
const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  paymentDate: "Payment date",
  commissionPercent: "Rate",
  requestedPercent: "Partner asked for a rate",
  requestStatus: "Rate request answered",
};

export default async function PartnerCommissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.COMMISSION_READ)) return <Forbidden what="partner commission" />;

  const { id } = await params;
  const c = await getPartnerCommission(id);
  if (!c) notFound();

  const canDecide = can(me, PERMISSIONS.COMMISSION_APPROVE);
  const dealWon = c.opportunity?.stage === "CLOSED_WON";
  const open = c.status === "IN_PROGRESS";

  return (
    <>
      <PageHeader
        backTo="/commissions"
        backLabel="Back to partner commission"
        title={c.opportunity?.name ?? c.commissionNumber}
        description={`${c.commissionNumber} · ${c.partner?.displayName ?? "Partner"}`}
      >
        <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Deal amount"
          value={formatMoney(c.baseAmount, c.currencyCode)}
          sublabel={open ? "After discounts, tax included. Follows the deal." : "As it stood when closed"}
        />
        <StatTile
          label="Commission"
          value={formatMoney(c.commissionAmount, c.currencyCode)}
          sublabel={`at ${formatPercent(c.commissionPercent, 2)}`}
          tone="info"
        />
        <StatTile
          label="Withholding tax"
          value={formatMoney(c.withholdingAmount, c.currencyCode)}
          sublabel={`at ${formatPercent(c.withholdingTaxPercent, 2)}`}
        />
        <StatTile
          label="Partner is paid"
          value={formatMoney(c.partnerAmount, c.currencyCode)}
          tone={c.status === "PAID" ? "success" : c.status === "REJECTED" ? "neutral" : "warning"}
        />
      </div>

      {c.status === "REJECTED" && (
        <div className="mt-6">
          <Alert tone="danger">
            Rejected{c.closedBy ? ` by ${c.closedBy.fullName}` : ""}
            {c.closedAt ? ` on ${formatDate(c.closedAt)}` : ""}: {c.rejectedReason}
          </Alert>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <DetailRow label="Partner">
                {c.partner ? (
                  <Link href={`/partners/${c.partner.id}`} className="text-primary hover:underline">
                    {c.partner.displayName}
                  </Link>
                ) : "—"}
              </DetailRow>
              <DetailRow label="Deal">
                {c.opportunity ? (
                  <Link href={`/opportunities/${c.opportunity.id}`} className="text-primary hover:underline">
                    {c.opportunity.opportunityNumber} · {c.opportunity.name}
                  </Link>
                ) : "—"}
              </DetailRow>
              <DetailRow label="Customer">{c.opportunity?.account?.name ?? "—"}</DetailRow>
              <DetailRow label="Deal stage">
                {c.opportunity ? (
                  <Badge tone={statusTone(c.opportunity.stage)}>{humanize(c.opportunity.stage)}</Badge>
                ) : "—"}
              </DetailRow>
              <DetailRow label="Won on">{c.opportunity?.actualCloseDate && dealWon ? formatDate(c.opportunity.actualCloseDate) : "Not won yet"}</DetailRow>
              <DetailRow label="Payment date">
                {c.paymentDate ? formatDate(c.paymentDate) : "Set when the deal is won"}
              </DetailRow>
              {c.status === "PAID" && (
                <DetailRow label="Marked paid">
                  {c.closedBy?.fullName ?? "—"}
                  {c.closedAt ? `, ${formatDateTime(c.closedAt)}` : ""}
                </DetailRow>
              )}
            </CardContent>
          </Card>

          {c.requestStatus && (
            <Card>
              <CardHeader>
                <CardTitle>Rate request</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  {c.requestedBy?.fullName ?? "The partner"} asked for{" "}
                  <strong>{formatPercent(c.requestedPercent, 2)}</strong> instead of{" "}
                  {c.requestStatus === "APPROVED" ? "the rate before" : formatPercent(c.commissionPercent, 2)}
                  {c.requestedAt ? ` on ${formatDate(c.requestedAt)}` : ""}.
                </p>
                <blockquote className="border-l-2 pl-3 text-muted-foreground">{c.requestReason}</blockquote>
                {c.requestStatus === "PENDING" ? (
                  canDecide ? (
                    <RateRequestDecision id={c.id} requestedPercent={String(c.requestedPercent)} />
                  ) : (
                    <p className="text-muted-foreground">Waiting for somebody who decides commission.</p>
                  )
                ) : (
                  <p>
                    <Badge tone={statusTone(c.requestStatus === "APPROVED" ? "APPROVED" : "REJECTED")}>
                      {c.requestStatus === "APPROVED" ? "Approved" : "Declined"}
                    </Badge>{" "}
                    {c.requestDecidedBy ? `by ${c.requestDecidedBy.fullName}` : ""}
                    {c.requestDecidedAt ? ` on ${formatDate(c.requestDecidedAt)}` : ""}
                    {c.requestDecisionReason ? `: ${c.requestDecisionReason}` : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {c.history.length === 0 ? (
                <p className="text-muted-foreground">
                  Nothing changed by hand yet. The amount has followed the deal on its own.
                </p>
              ) : (
                <ul className="space-y-3">
                  {c.history.map((h: Record<string, any>) => (
                    <li key={h.id} className="border-b pb-2 last:border-0">
                      <p className="font-medium">{FIELD_LABELS[h.fieldName] ?? humanize(h.fieldName)}</p>
                      <p className="text-muted-foreground">
                        {h.oldValue ? `${h.oldValue} → ` : ""}{h.newValue}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {h.changedBy?.fullName ?? "System"}
                        {h.source === "portal" ? " (partner portal)" : ""} · {formatDateTime(h.changedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          {open && canDecide ? (
            <CommissionActions
              id={c.id}
              dealWon={dealWon}
              currentPercent={String(c.commissionPercent)}
              paymentDate={c.paymentDate}
              requestPending={c.requestStatus === "PENDING"}
            />
          ) : (
            <Card>
              <CardContent className="pt-5 text-sm text-muted-foreground">
                {open
                  ? "Only people who decide commission can change this record."
                  : "This commission is closed and can no longer change."}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
