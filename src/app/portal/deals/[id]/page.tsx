import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { getPartnerDeal } from "@/server/partner-deals";
import { listPartnerActivities } from "@/server/partner-leads";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, Button, DetailRow, StatTile, statusTone,
} from "@/components/ui";
import { formatDate, formatMoney, formatPercent, humanize } from "@/lib/utils";
import { PartnerActivityPanel } from "../../activity-panel";
import { PartnerStageControl } from "./stage-control";

/**
 * One of the partner's deals, as they work it: what it is worth, what they earn
 * on it, where it stands, and everything done on it.
 */
export default async function PortalDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deal, activities] = await Promise.all([getPartnerDeal(id), listPartnerActivities("Opportunity", id)]);
  if (!deal) notFound();

  const closed = deal.stage === "CLOSED_WON" || deal.stage === "CLOSED_LOST";
  const accepted = deal.quotations.find((q) => q.status === "ACCEPTED");

  return (
    <>
      <PageHeader
        backTo="/portal/deals"
        backLabel="Back to opportunities"
        title={deal.name}
        description={`${deal.opportunityNumber}${deal.account ? ` · ${deal.account.name}` : ""}`}
      >
        <Badge tone={statusTone(deal.stage)}>{humanize(deal.stage)}</Badge>
        {deal.stage !== "CLOSED_LOST" && (
          <Button asChild variant="outline">
            <Link href={`/portal/deals/${deal.id}/edit`}>
              <Pencil className="h-4 w-4" /> Edit
            </Link>
          </Button>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Deal value"
          value={formatMoney(deal.amount, deal.currencyCode)}
          sublabel={deal.pricedByLines ? "The total of its products and services" : "An estimate until products are added"}
        />
        <StatTile
          label="Your commission"
          value={deal.commission ? formatMoney(deal.commission.partnerAmount, deal.currencyCode) : "—"}
          sublabel={deal.commission
            ? `${formatPercent(deal.commission.commissionPercent, 2)} · ${humanize(deal.commission.status)}`
            : "None on this deal"}
          tone={deal.commission?.status === "PAID" ? "success" : "neutral"}
        />
        <StatTile
          label={closed ? "Closed on" : "Expected close"}
          value={formatDate(deal.actualCloseDate ?? deal.expectedCloseDate)}
          sublabel={deal.commission?.paymentDate ? `Commission due ${formatDate(deal.commission.paymentDate)}` : undefined}
        />
        <StatTile
          label="Probability"
          value={deal.probabilityPercent != null ? `${Number(deal.probabilityPercent)}%` : "—"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PartnerStageControl
            dealId={deal.id}
            stage={deal.stage}
            hasAcceptedQuote={Boolean(accepted)}
          />

          <Card>
            <CardHeader>
              <CardTitle>Quotations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {deal.quotations.length === 0 ? (
                <p className="text-muted-foreground">
                  No quotes yet. A deal is won on an accepted quotation.
                </p>
              ) : (
                deal.quotations.map((q) => (
                  <div key={q.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <div>
                      <span className="font-mono text-xs">{q.quoteNumber}</span>
                      <p className="text-xs text-muted-foreground">v{q.versionNumber}</p>
                    </div>
                    <div className="text-right">
                      <p className="tabular">{formatMoney(q.totalAmount, q.currencyCode)}</p>
                      <Badge tone={statusTone(q.status)}>{humanize(q.status)}</Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <PartnerActivityPanel entityType="Opportunity" entityId={deal.id} activities={activities} canLog={deal.stage !== "CLOSED_LOST"} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Account">
              {deal.account ? (
                <Link href={`/portal/customers/${deal.account.id}`} className="text-primary hover:underline">
                  {deal.account.name}
                </Link>
              ) : "—"}
            </DetailRow>
            <DetailRow label="Main contact">
              {deal.primaryContact ? `${deal.primaryContact.firstName} ${deal.primaryContact.lastName}` : "—"}
            </DetailRow>
            <DetailRow label="Type">{deal.opportunityType ? humanize(deal.opportunityType) : "—"}</DetailRow>
            <DetailRow label="Lead source">{deal.leadSource ?? "—"}</DetailRow>
            <DetailRow label="Next step">{deal.nextStep ?? "—"}</DetailRow>
            <DetailRow label="Competitor">{deal.competitorName ?? "—"}</DetailRow>
            {deal.lossReason && <DetailRow label="Why it was lost">{deal.lossReason}</DetailRow>}
            {deal.description && (
              <DetailRow label="Notes"><p className="whitespace-pre-wrap">{deal.description}</p></DetailRow>
            )}
            <DetailRow label="Currency">{deal.currencyCode}</DetailRow>
            <DetailRow label="Added">{formatDate(deal.createdAt)}</DetailRow>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
