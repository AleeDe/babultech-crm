import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, User, Mail, Phone, Globe, MapPin } from "lucide-react";
import { getPartner, getPartnerSummary } from "@/server/partners";
import { getAuditTrail } from "@/lib/audit";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, StatTile, EmptyState, Button, Alert, Forbidden
} from "@/components/ui";
import { protectionDaysFor } from "@/lib/partner-policy";
import { formatMoney, formatDate, formatPercent, humanize } from "@/lib/utils";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";

export default async function PartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.PARTNER_READ)) return <Forbidden what="partners" />;

  const { id } = await params;
  const [partner, summary] = await Promise.all([getPartner(id), getPartnerSummary(id)]);
  if (!partner) notFound();

  const audit = await getAuditTrail("Partner", id, 15);

  const bank = (partner.bankDetails ?? {}) as Record<string, string | undefined>;
  const agreementExpired =
    partner.agreementExpiryDate && partner.agreementExpiryDate < new Date();

  return (
    <>
      <PageHeader
        title={partner.displayName}
        description={`${partner.partnerNumber} · ${humanize(partner.partnerType)} partner · ${humanize(partner.tier)} tier`}
      >
        <Badge tone={statusTone(partner.status)}>{humanize(partner.status)}</Badge>
      </PageHeader>

      {agreementExpired && (
        <div className="mb-5">
          <Alert tone="warning">
            The partner agreement expired on {formatDate(partner.agreementExpiryDate)}. New commission
            accruals will still be created — renew or terminate the agreement to stop them.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open pipeline" value={formatMoney(summary.openPipeline)} sublabel={`${summary.dealsOpen} live deals`} tone="info" />
        <StatTile label="Won value" value={formatMoney(summary.wonValue)} sublabel={`${summary.dealsWon} won · ${summary.dealsLost} lost`} tone="success" />
        <StatTile
          label="Win rate"
          value={summary.winRate === null ? "—" : `${summary.winRate.toFixed(0)}%`}
          sublabel="Closed deals only"
        />
        <StatTile label="Commission owed" value={formatMoney(summary.commissionPayable)} sublabel={`${formatMoney(summary.commissionPaid)} paid to date`} tone="warning" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {partner.kind === "COMPANY" ? <Building2 className="h-4 w-4" /> : <User className="h-4 w-4" />}
              {partner.kind === "COMPANY" ? "Company partner" : "Individual partner"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {partner.kind === "COMPANY" && partner.account && (
              <Row label="Account">
                <Link href={`/accounts/${partner.account.id}`} className="text-primary hover:underline">
                  {partner.account.name}
                </Link>
              </Row>
            )}
            {partner.kind === "INDIVIDUAL" && partner.contact && (
              <Row label="Contact">
                <span>
                  {partner.contact.firstName} {partner.contact.lastName}
                </span>
                {!partner.contact.accountId && (
                  <p className="text-xs text-muted-foreground">Not linked to any company — by design.</p>
                )}
              </Row>
            )}
            <Row label="Partner manager">{partner.partnerManager?.fullName ?? "Unassigned"}</Row>
            <Row label="Territory">
              {partner.territory ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  {partner.territory}
                </span>
              ) : "—"}
            </Row>
            <Row label="Email">
              {partner.email ? (
                <a href={`mailto:${partner.email}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Mail className="h-3.5 w-3.5" />
                  {partner.email}
                </a>
              ) : "—"}
            </Row>
            <Row label="Phone">
              {partner.phone ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {partner.phone}
                </span>
              ) : "—"}
            </Row>
            <Row label="Website">
              {partner.website ? (
                <a href={partner.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Globe className="h-3.5 w-3.5" />
                  Visit
                </a>
              ) : "—"}
            </Row>
            <Row label="Deal protection">
              {protectionDaysFor(partner.tier, partner.registrationProtectionDays)} days
              {partner.registrationProtectionDays
                ? " (negotiated)"
                : ` (${humanize(partner.tier)} tier default)`}
            </Row>
            <Row label="Agreement">
              {partner.startDate ? formatDate(partner.startDate) : "—"}
              {partner.agreementExpiryDate && ` → ${formatDate(partner.agreementExpiryDate)}`}
            </Row>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Commission terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {partner.commissionPlan ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Row label="Plan">{partner.commissionPlan.name}</Row>
                  <Row label="Basis">{humanize(partner.commissionPlan.basis)}</Row>
                  <Row label="Earned when">{humanize(partner.commissionPlan.trigger)}</Row>
                  <Row label="Rate type">{humanize(partner.commissionPlan.rateType)}</Row>
                  <Row label="Payout delay">{partner.commissionPlan.payoutDelayDays} days</Row>
                  <Row label="Clawback window">
                    {partner.commissionPlan.clawbackWindowDays
                      ? `${partner.commissionPlan.clawbackWindowDays} days`
                      : "None"}
                  </Row>
                </div>

                {partner.commissionPlan.rateType === "TIERED_PERCENT" &&
                  partner.commissionPlan.tiers.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Tiers (applied progressively)
                      </p>
                      <Table>
                        <THead>
                          <TR>
                            <TH>From</TH>
                            <TH>To</TH>
                            <TH className="text-right">Rate</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {partner.commissionPlan.tiers.map((t: Record<string, any>) => (
                            <TR key={t.id}>
                              <TD className="tabular">{formatMoney(t.fromAmount)}</TD>
                              <TD className="tabular">{t.toAmount ? formatMoney(t.toAmount) : "and above"}</TD>
                              <TD className="text-right tabular">{formatPercent(t.ratePercent)}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </div>
                  )}

                {partner.commissionPlan.rateType === "FLAT_PERCENT" && (
                  <Row label="Flat rate">{formatPercent(partner.commissionPlan.flatPercent)}</Row>
                )}
              </>
            ) : (
              <Alert tone="info">
                No commission plan assigned. Deals fall back to the partner default rate of{" "}
                <strong>{formatPercent(partner.defaultCommissionPercent)}</strong>, applied to the
                opportunity amount when the customer pays.
              </Alert>
            )}

            <div className="grid gap-3 border-t pt-4 sm:grid-cols-3">
              <Row label="Payout currency">{partner.payoutCurrencyCode}</Row>
              <Row label="Withholding tax">{formatPercent(partner.withholdingTaxPercent)}</Row>
              <Row label="Tax number">{partner.taxNumber ?? "—"}</Row>
              <Row label="Bank">{bank.bankName ?? "—"}</Row>
              <Row label="Account title">{bank.accountTitle ?? "—"}</Row>
              <Row label="IBAN / account">{bank.iban ?? bank.accountNumber ?? "—"}</Row>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Deals ({partner.opportunities.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {partner.opportunities.length === 0 ? (
            <div className="px-5">
              <EmptyState
                title="No deals attached yet"
                description="Attach this partner to an opportunity from the deal page to start earning commission."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Deal</TH>
                  <TH>Customer</TH>
                  <TH>Role</TH>
                  <TH className="text-right">Share</TH>
                  <TH className="text-right">Rate</TH>
                  <TH className="text-right">Deal value</TH>
                  <TH>Stage</TH>
                </TR>
              </THead>
              <TBody>
                {partner.opportunities.map((link: Record<string, any>) => (
                  <TR key={link.id}>
                    <TD>
                      <Link href={`/opportunities/${link.opportunity.id}`} className="font-medium hover:underline">
                        {link.opportunity.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{link.opportunity.opportunityNumber}</p>
                    </TD>
                    <TD className="text-sm">{link.opportunity.account.name}</TD>
                    <TD>
                      <Badge tone="neutral">{humanize(link.role)}</Badge>
                    </TD>
                    <TD className="text-right tabular">{formatPercent(link.revenueSharePercent, 0)}</TD>
                    <TD className="text-right tabular">
                      {link.commissionPercentOverride
                        ? `${formatPercent(link.commissionPercentOverride)} (override)`
                        : "plan"}
                    </TD>
                    <TD className="text-right tabular">
                      {formatMoney(link.opportunity.amount, link.opportunity.currencyCode)}
                    </TD>
                    <TD>
                      <Badge tone={statusTone(link.opportunity.stage)}>{humanize(link.opportunity.stage)}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Commission ledger ({partner.commissionRecords.length})</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link href={`/commissions?partnerId=${partner.id}`}>Open in ledger</Link>
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          {partner.commissionRecords.length === 0 ? (
            <div className="px-5">
              <EmptyState
                title="Nothing earned yet"
                description="Commission is created automatically when the plan's trigger fires — a deal is won, an invoice is sent, or a payment clears."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Number</TH>
                  <TH>Deal</TH>
                  <TH>Earned</TH>
                  <TH className="text-right">Basis</TH>
                  <TH className="text-right">Rate</TH>
                  <TH className="text-right">Gross</TH>
                  <TH className="text-right">Net payable</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {partner.commissionRecords.map((r: Record<string, any>) => (
                  <TR key={r.id}>
                    <TD className="font-mono text-xs">{r.commissionNumber}</TD>
                    <TD className="text-sm">{r.opportunity.name}</TD>
                    <TD className="text-sm">{formatDate(r.earnedDate)}</TD>
                    <TD className="text-right tabular">{formatMoney(r.basisAmount, r.currencyCode)}</TD>
                    <TD className="text-right tabular">{formatPercent(r.ratePercent)}</TD>
                    <TD className="text-right tabular">{formatMoney(r.commissionAmount, r.currencyCode)}</TD>
                    <TD className="text-right font-medium tabular">{formatMoney(r.netPayableAmount, r.currencyCode)}</TD>
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

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Referred leads ({partner.referredLeads.length})</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {partner.referredLeads.length === 0 ? (
              <p className="px-5 pb-2 text-sm text-muted-foreground">No referrals recorded.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Lead</TH>
                    <TH>Company</TH>
                    <TH className="text-right">Est. value</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {partner.referredLeads.map((l: Record<string, any>) => (
                    <TR key={l.id}>
                      <TD className="text-sm">
                        {l.firstName} {l.lastName}
                      </TD>
                      <TD className="text-sm text-muted-foreground">{l.companyName ?? "—"}</TD>
                      <TD className="text-right tabular">{formatMoney(l.estimatedValue)}</TD>
                      <TD>
                        <Badge tone={statusTone(l.status)}>{humanize(l.status)}</Badge>
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
            <CardTitle>Change history</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {audit.length === 0 ? (
              <p className="px-5 pb-2 text-sm text-muted-foreground">No changes recorded yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {audit.map((a: Record<string, any>) => (
                  <li key={a.id} className="px-5 py-2.5">
                    <p>
                      <span className="font-medium">{humanize(a.fieldName)}</span>{" "}
                      <span className="text-muted-foreground">
                        {a.oldValue ?? "empty"} → {a.newValue ?? "empty"}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.changedBy?.fullName ?? "System"} · {formatDate(a.changedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
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
