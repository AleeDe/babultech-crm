import Link from "next/link";
import { notFound } from "next/navigation";
import { getOpportunity } from "@/server/opportunities";
import { supabaseServer } from "@/lib/supabase";
import { one } from "@/lib/decimal";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getAuditTrail } from "@/lib/audit";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, EmptyState, StatTile, Button, Forbidden
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, humanize, serialize } from "@/lib/utils";
import { PartnerPanel, StageControl } from "./partner-panel";

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="opportunities" />;

  const { id } = await params;
  const [opp, availablePartners] = await Promise.all([
    getOpportunity(id),
    (async () => {
      const db = await supabaseServer();
      const { data } = await db
        .from("partner")
        .select("id, displayName, partnerNumber, kind")
        .is("deletedAt", null)
        .eq("status", "ACTIVE")
        .order("displayName");
      return data ?? [];
    })(),
  ]);
  if (!opp) notFound();

  const audit = await getAuditTrail("Opportunity", id, 15);
  const acceptedQuote = opp.quotations.find((q: Record<string, any>) => q.status === "ACCEPTED");

  return (
    <>
      <PageHeader title={opp.name} description={`${opp.opportunityNumber} · ${opp.account?.name}`}>
        <Badge tone={statusTone(opp.stage)}>{humanize(opp.stage)}</Badge>
        <Button asChild variant="outline">
          <Link href={`/opportunities/${opp.id}/edit`}>Edit</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Deal value" value={formatMoney(opp.amount, opp.currencyCode)} />
        <StatTile
          label="Weighted"
          value={formatMoney(
            (Number(opp.amount) * Number(opp.probabilityPercent)) / 100,
            opp.currencyCode,
          )}
          sublabel={`${Number(opp.probabilityPercent).toFixed(0)}% probability`}
          tone="info"
        />
        <StatTile label="Expected close" value={formatDate(opp.expectedCloseDate)} sublabel={humanize(opp.opportunityType)} />
        <StatTile
          label="Commission accrued"
          value={formatMoney(
            opp.commissionRecords.reduce((s: any, r: Record<string, any>) => s + Number(r.commissionAmount), 0),
            opp.currencyCode,
          )}
          sublabel={`${opp.commissionRecords.length} record(s)`}
          tone={opp.commissionRecords.length > 0 ? "warning" : "neutral"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PartnerPanel
            opportunityId={opp.id}
            amount={String(opp.amount)}
            currencyCode={opp.currencyCode}
            links={serialize(opp.partners) as never}
            availablePartners={availablePartners}
          />

          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {opp.lines.length === 0 ? (
                <p className="px-5 pb-2 text-sm text-muted-foreground">No products added.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Product</TH>
                      <TH className="text-right">Qty</TH>
                      <TH className="text-right">Unit price</TH>
                      <TH className="text-right">Discount</TH>
                      <TH className="text-right">Total</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {opp.lines.map((l: Record<string, any>) => (
                      <TR key={l.id}>
                        <TD className="text-sm">
                          <Link href={`/products/${l.product?.id}`} className="font-medium hover:underline">
                            {l.product?.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">{l.product?.productCode}</p>
                        </TD>
                        <TD className="text-right tabular">{Number(l.quantity)}</TD>
                        <TD className="text-right tabular">{formatMoney(l.unitPrice, opp.currencyCode)}</TD>
                        <TD className="text-right tabular">{formatPercent(l.discountPercent)}</TD>
                        <TD className="text-right font-medium tabular">
                          {formatMoney(l.lineTotal, opp.currencyCode)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Commission records</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {opp.commissionRecords.length === 0 ? (
                <div className="px-5">
                  <EmptyState
                    title="Nothing accrued yet"
                    description="Commission is created when this deal reaches its plan's trigger point."
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Number</TH>
                      <TH>Partner</TH>
                      <TH>Earned</TH>
                      <TH className="text-right">Gross</TH>
                      <TH className="text-right">Net</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {opp.commissionRecords.map((r: Record<string, any>) => (
                      <TR key={r.id}>
                        <TD className="font-mono text-xs">{r.commissionNumber}</TD>
                        <TD className="text-sm">
                          <Link href={`/partners/${r.partner?.id}`} className="hover:underline">
                            {r.partner?.displayName}
                          </Link>
                        </TD>
                        <TD className="text-sm">{formatDate(r.earnedDate)}</TD>
                        <TD className="text-right tabular">{formatMoney(r.commissionAmount, r.currencyCode)}</TD>
                        <TD className="text-right font-medium tabular">
                          {formatMoney(r.netPayableAmount, r.currencyCode)}
                        </TD>
                        <TD>
                          <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <StageControl opportunityId={opp.id} currentStage={opp.stage} />

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Account">
                <Link href={`/accounts/${opp.account?.id}`} className="text-primary hover:underline">
                  {opp.account?.name}
                </Link>
              </Row>
              <Row label="Primary contact">
                {opp.primaryContact ? (
                  <Link href={`/contacts/${opp.primaryContact?.id}/edit`} className="text-primary hover:underline">
                    {opp.primaryContact?.firstName} {opp.primaryContact?.lastName}
                  </Link>
                ) : "—"}
              </Row>
              <Row label="Owner">{opp.owner?.fullName}</Row>
              <Row label="Campaign">
                {opp.campaign ? (
                  <Link href={`/campaigns/${opp.campaign.id}`} className="text-primary hover:underline">
                    {opp.campaign.name}
                  </Link>
                ) : "—"}
              </Row>
              <Row label="Lead source">{opp.leadSource ?? "—"}</Row>
              <Row label="Next step">{opp.nextStep ?? "—"}</Row>
              {opp.lossReason && <Row label="Loss reason">{opp.lossReason}</Row>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quotations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {opp.quotations.length === 0 ? (
                <p className="text-muted-foreground">
                  No quotes yet. A deal cannot be marked Closed Won without an accepted quotation.
                </p>
              ) : (
                opp.quotations.map((q: Record<string, any>) => (
                  <div key={q.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <div>
                      <Link href={`/quotations/${q.id}`} className="font-mono text-xs hover:underline">
                        {q.quoteNumber}
                      </Link>
                      <p className="text-xs text-muted-foreground">v{q.versionNumber}</p>
                    </div>
                    <div className="text-right">
                      <p className="tabular">{formatMoney(q.totalAmount, q.currencyCode)}</p>
                      <Badge tone={statusTone(q.status)}>{humanize(q.status)}</Badge>
                    </div>
                  </div>
                ))
              )}
              {acceptedQuote && (
                <p className="pt-1 text-xs text-emerald-600 dark:text-emerald-400">
                  {acceptedQuote.quoteNumber} accepted — this deal can be won.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Change history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {audit.length === 0 ? (
                <p className="text-muted-foreground">No changes recorded.</p>
              ) : (
                audit.map((a: Record<string, any>) => (
                  <div key={a.id}>
                    <p>
                      <span className="font-medium">{humanize(a.fieldName)}</span>{" "}
                      <span className="text-muted-foreground">
                        {a.oldValue ?? "empty"} → {a.newValue ?? "empty"}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.changedBy?.fullName ?? "System"} · {formatDate(a.changedAt)}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
